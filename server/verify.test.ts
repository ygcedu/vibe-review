import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentPermissionRequest, AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { isAllowedVerificationPermission, isVerifierHookAgent, usedVerificationTool, verifyWithPaseoProvider, VERIFIER_LABEL, VERIFIER_TITLE } from "./verify.ts";
import { DEFAULT_VERIFICATION_PROMPT } from "../shared/prompts.ts";

test("verifier lifecycle events are recognized without labels", () => {
  assert.equal(isVerifierHookAgent({ title: VERIFIER_TITLE, parentAgentId: "parent-1" }), true);
  assert.equal(isVerifierHookAgent({ title: VERIFIER_TITLE, parentAgentId: null }), false);
  assert.equal(isVerifierHookAgent({ title: "Other agent", parentAgentId: "parent-1" }), false);
});

const observation = { type: "tool_call", name: "mcp__paseo__browser_snapshot", status: "completed" } as AgentTimelineItem;

test("an actual inspection tool is required for a passed verification", async () => {
  assert.equal(usedVerificationTool([observation]), true);
  assert.equal(usedVerificationTool([{ ...observation, status: "failed" } as AgentTimelineItem]), false);
  assert.equal(usedVerificationTool([{ ...observation, name: "shell" } as AgentTimelineItem]), true);
  assert.equal(usedVerificationTool([{ ...observation, name: "mcp__paseo__browser_navigate" } as AgentTimelineItem]), false);
  const noHost = { ...observation, detail: { type: "unknown", input: {}, output: { structuredContent: { ok: false } } } } as AgentTimelineItem;
  assert.equal(usedVerificationTool([noHost]), false);
  const computerObservation = { ...observation, name: "cua_repl.js", detail: { type: "unknown", input: { code: "await tab.getAXState();" }, output: {} } } as AgentTimelineItem;
  assert.equal(usedVerificationTool([computerObservation]), true);
  assert.equal(usedVerificationTool([{ ...computerObservation, detail: { type: "unknown", input: { code: "await tab.goto('/');" }, output: {} } } as AgentTimelineItem]), false);

  let createdIn = "";
  let createdOptions: Record<string, unknown> = {};
  let archived = false;
  let items: AgentTimelineItem[] = [];
  let lastMessage = JSON.stringify({ status: "passed", summary: "页面显示新按钮", evidence: ["浏览器快照中找到按钮"], cases: [{ name: "按钮存在", steps: ["打开页面", "读取页面内容"], expected: "能找到按钮", actual: "找到按钮", status: "passed" }] });
  const verifier = {
    waitForFinish: async () => ({ status: "idle", lastMessage }),
    timeline: { refetch: async () => ({ entries: items.map((item) => ({ item })) }) },
    archive: async () => { archived = true; },
  };
  const paseo = {
    agents: { ref: () => ({ current: () => ({ workspaceId: "workspace-1" }) }) },
    workspaces: { ref: (id: string) => ({ agents: { create: async (options: Record<string, unknown>) => {
      createdIn = id;
      createdOptions = options;
      return verifier;
    } } }) },
  } as unknown as PluginHandlerContext["paseo"];
  const config = { enabled: true, provider: "codex", model: "gpt-6-sol", modeId: "full-access" };
  const request = { goal: "检查按钮", narrative: "已添加按钮", assistantMessages: ["按钮已实现"] };

  const withoutTool = await verifyWithPaseoProvider(paseo, "parent-1", config, request);
  assert.equal(withoutTool.status, "unavailable");
  items = [{ ...observation, name: "shell" } as AgentTimelineItem];
  const verified = await verifyWithPaseoProvider(paseo, "parent-1", config, request);
  assert.equal(verified.status, "passed");
  assert.equal(verified.cases?.[0].name, "按钮存在");
  assert.equal(verified.provider, "codex/gpt-6-sol");
  assert.equal(createdIn, "workspace-1");
  assert.deepEqual(createdOptions.labels, { [VERIFIER_LABEL]: "true" });
  assert.deepEqual(createdOptions.config, {
    provider: "codex/gpt-6-sol",
    modeId: "full-access",
    options: { approval_policy: "never", sandbox_mode: "danger-full-access" },
    systemPrompt: "你是独立验证员。只读检查，不得修改工作区或用户数据。",
  });
  assert.equal(createdOptions.autoArchive, undefined);
  assert.equal(archived, true);
  assert.match(String(createdOptions.prompt), /运行测试或操作功能/);
  assert.doesNotMatch(String(createdOptions.prompt), /changed_files|assistant_messages/);
  await verifyWithPaseoProvider(paseo, "parent-1", config, request, undefined, `自定义验证步骤：\n${DEFAULT_VERIFICATION_PROMPT}`);
  assert.match(String(createdOptions.prompt), /自定义验证步骤/);
  assert.match(String(createdOptions.prompt), /"cases"/);
  lastMessage = '{"status":"passed","summary":"看起来正常","evidence":[],"cases":[]}';
  assert.equal((await verifyWithPaseoProvider(paseo, "parent-1", config, request)).status, "unavailable");
  lastMessage = '{"status":"passed","summary":"看起来正常","evidence":["运行了检查"],"cases":[]}';
  assert.equal((await verifyWithPaseoProvider(paseo, "parent-1", config, request)).status, "unavailable");
  const longActual = "第七项检查发现未满足预期。".repeat(40);
  lastMessage = JSON.stringify({ status: "passed", summary: "已执行七项检查", evidence: ["已查看实际页面"], cases: [
    ...Array.from({ length: 6 }, (_, index) => ({ name: `用例 ${index + 1}`, steps: ["检查页面"], expected: "通过", actual: "通过", status: "passed" })),
    { name: "用例 7", steps: ["检查页面"], expected: "通过", actual: longActual, status: "failed" },
  ] });
  const laterFailure = await verifyWithPaseoProvider(paseo, "parent-1", config, request);
  assert.equal(laterFailure.status, "failed");
  assert.equal(laterFailure.cases?.length, 7);
  assert.equal(laterFailure.cases?.[6].actual, longActual);
});

test("verification resumes after a transient Paseo transport disconnect", async () => {
  let waits = 0;
  let archived = false;
  const verifier = {
    waitForFinish: async () => {
      if (++waits === 1) throw Object.assign(new Error("Transport closed"), { code: "DAEMON_CONNECTION_LOST" });
      return { status: "idle", lastMessage: '{"status":"passed","summary":"已检查设置页","evidence":["页面包含验证设置"],"cases":[{"name":"设置页内容","steps":["读取设置页"],"expected":"设置存在","actual":"设置存在","status":"passed"}]}' };
    },
    timeline: { refetch: async () => ({ entries: [{ item: observation }] }) },
    archive: async () => { archived = true; },
  };
  const paseo = {
    agents: { ref: () => ({ current: () => ({ workspaceId: "workspace-1" }) }) },
    workspaces: { ref: () => ({ agents: { create: async () => verifier } }) },
  } as unknown as PluginHandlerContext["paseo"];
  const result = await verifyWithPaseoProvider(paseo, "parent-1", { enabled: true, provider: "codex", model: "gpt-6-sol", modeId: "full-access" }, { goal: "检查设置页", narrative: "已更新", assistantMessages: [] });
  assert.equal(result.status, "passed");
  assert.equal(waits, 2);
  assert.equal(archived, true);
});

test("the verifier uses Paseo's unbounded wait instead of polling", async () => {
  const waits: Array<number | undefined> = [];
  const verifier = {
    id: "verifier-timeout",
    waitForFinish: async (timeoutMs?: number) => { waits.push(timeoutMs); return { status: "idle", lastMessage: '{"status":"passed","summary":"已核对","evidence":["页面快照"],"cases":[{"name":"页面","steps":["读取页面"],"expected":"可见","actual":"可见","status":"passed"}]}' }; },
    timeline: { refetch: async () => ({ entries: [{ item: observation }] }) },
    archive: async () => {},
  };
  const paseo = {
    agents: { ref: () => ({ current: () => ({ workspaceId: "workspace-1" }) }) },
    workspaces: { ref: () => ({ agents: { create: async () => verifier } }) },
  } as unknown as PluginHandlerContext["paseo"];
  const result = await verifyWithPaseoProvider(paseo, "parent-1", { enabled: true, provider: "codex", model: "gpt-6-sol", modeId: "full-access" }, { goal: "页面", narrative: "已修改", assistantMessages: [] });
  assert.equal(result.status, "passed");
  assert.deepEqual(waits, [0]);
});

test("full-access verifier answers provider permission requests without prompting", async () => {
  const permission = { id: "permission-1", provider: "codex", kind: "tool", name: "CodexMcpElicitation", description: 'Allow the paseo MCP server to run tool "browser_list_tabs"?', metadata: { serverName: "paseo" } } as AgentPermissionRequest;
  assert.equal(isAllowedVerificationPermission(permission), true);
  assert.equal(isAllowedVerificationPermission({ ...permission, description: 'Allow the paseo MCP server to run tool "browser_click"?' }), false);
  assert.equal(isAllowedVerificationPermission({ ...permission, metadata: { serverName: "other" } }), false);
  assert.equal(isAllowedVerificationPermission({ ...permission, name: "paseo.browser_snapshot" }), true);
  const computerPermission = { ...permission, description: 'Allow the paseo MCP server to run tool "computer_screenshot"?' };
  assert.equal(isAllowedVerificationPermission(computerPermission), false);

  let waits = 0;
  const approvals: string[] = [];
  const verifier = {
    waitForFinish: async () => ++waits === 1
      ? { status: "permission" }
      : { status: "idle", lastMessage: '{"status":"passed","summary":"已核对页面","evidence":["快照中有目标按钮"],"cases":[{"name":"按钮存在","steps":["读取页面"],"expected":"找到按钮","actual":"找到按钮","status":"passed"}]}' },
    refresh: async () => ({ agent: { pendingPermissions: [computerPermission] } }),
    current: () => null,
    respondToPermission: async ({ requestId }: { requestId: string }) => { approvals.push(requestId); },
    timeline: { refetch: async () => ({ entries: [{ item: observation }] }) },
    archive: async () => {},
  };
  const paseo = {
    agents: { ref: () => ({ current: () => ({ workspaceId: "workspace-1" }) }) },
    workspaces: { ref: () => ({ agents: { create: async () => verifier } }) },
  } as unknown as PluginHandlerContext["paseo"];
  const result = await verifyWithPaseoProvider(paseo, "parent-1", { enabled: true, provider: "codex", model: "gpt-6-sol", modeId: "full-access" }, { goal: "核对按钮", narrative: "已实现", assistantMessages: [] });
  assert.equal(result.status, "passed");
  assert.deepEqual(approvals, ["permission-1"]);
});
