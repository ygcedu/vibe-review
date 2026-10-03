import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentPermissionRequest, AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { isAllowedVerificationPermission, usedVerificationTool, verifyWithPaseoProvider, VERIFIER_LABEL } from "./verify.ts";

const observation = { type: "tool_call", name: "mcp__paseo__browser_snapshot", status: "completed" } as AgentTimelineItem;

test("browser observation is required for a passed verification", async () => {
  assert.equal(usedVerificationTool([observation]), true);
  assert.equal(usedVerificationTool([{ ...observation, status: "failed" } as AgentTimelineItem]), false);
  assert.equal(usedVerificationTool([{ ...observation, name: "shell" } as AgentTimelineItem]), false);
  const noHost = { ...observation, detail: { type: "unknown", input: {}, output: { structuredContent: { ok: false } } } } as AgentTimelineItem;
  assert.equal(usedVerificationTool([noHost]), false);
  const computerObservation = { ...observation, name: "cua_repl.js", detail: { type: "unknown", input: { code: "await tab.getAXState();" }, output: {} } } as AgentTimelineItem;
  assert.equal(usedVerificationTool([computerObservation]), true);

  let createdIn = "";
  let createdOptions: Record<string, unknown> = {};
  let archived = false;
  let items: AgentTimelineItem[] = [];
  let lastMessage = '{"status":"passed","summary":"页面显示新按钮","evidence":["浏览器快照中找到按钮"]}';
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
  items = [observation];
  const verified = await verifyWithPaseoProvider(paseo, "parent-1", config, request);
  assert.equal(verified.status, "passed");
  assert.equal(verified.provider, "codex/gpt-6-sol");
  assert.equal(createdIn, "workspace-1");
  assert.deepEqual(createdOptions.labels, { [VERIFIER_LABEL]: "true" });
  assert.deepEqual(createdOptions.config, {
    provider: "codex/gpt-6-sol",
    modeId: "full-access",
    options: { approval_policy: "never", sandbox_mode: "danger-full-access" },
    systemPrompt: "你是独立验证员。只读检查，不得修改工作区或用户数据。",
  });
  assert.equal(createdOptions.autoArchive, true);
  assert.equal(archived, true);
  lastMessage = '{"status":"passed","summary":"看起来正常","evidence":[]}';
  assert.equal((await verifyWithPaseoProvider(paseo, "parent-1", config, request)).status, "unavailable");
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
      : { status: "idle", lastMessage: '{"status":"passed","summary":"已核对页面","evidence":["快照中有目标按钮"]}' },
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
