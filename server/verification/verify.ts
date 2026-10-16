import type { AgentPermissionRequest, AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { VerificationConfig } from "../../shared/settings";
import { DEFAULT_VERIFICATION_PROMPT, renderPrompt } from "../../shared/prompts.ts";
import { parseFirstJsonObject } from "../llm-response.ts";

export const VERIFIER_LABEL = "vibe-review.verification";
export const VERIFIER_TITLE = "Vibe Review · 验证";

// Lifecycle hook agents expose title and parentAgentId, but not SDK labels.
export function isVerifierHookAgent(agent: { title: string | null; parentAgentId: string | null }): boolean {
  return agent.title === VERIFIER_TITLE && agent.parentAgentId !== null;
}

function isTransportDisconnect(error: unknown): boolean {
  const value = error as { code?: string; message?: string } | null;
  return value?.code === "DAEMON_CONNECTION_LOST" || /Transport (?:closed|not connected)/i.test(value?.message ?? "");
}

async function retryAfterReconnect<T>(operation: () => Promise<T>): Promise<T> {
  let disconnectedAt: number | undefined;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransportDisconnect(error)) throw error;
      disconnectedAt ??= Date.now();
      if (Date.now() - disconnectedAt >= 6 * 60_000) throw new Error("与 Paseo 的连接持续中断，未能取得验证结果。", { cause: error });
      console.warn("[vibe-review] verification transport disconnected; waiting to reconnect");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

/** Only observational/navigation browser tools may be approved unattended. */
const ALLOWED_BROWSER_TOOLS = new Set([
  "browser_list_tabs", "browser_new_tab", "browser_snapshot", "browser_navigate", "browser_screenshot", "browser_scroll", "browser_wait",
]);

export function isAllowedVerificationPermission(request: AgentPermissionRequest): boolean {
  const direct = /^(?:mcp__paseo__|paseo\.)(browser_[a-z_]+)$/.exec(request.name);
  if (direct) return ALLOWED_BROWSER_TOOLS.has(direct[1]);
  // Codex reports MCP tool approval as a generic elicitation. Verify the server
  // identity and exact tool quoted by Paseo, rather than approving all prompts.
  if (request.name !== "CodexMcpElicitation" || request.kind !== "tool" || request.metadata?.serverName !== "paseo") return false;
  const quoted = /^Allow the paseo MCP server to run tool "(browser_[a-z_]+)"\?$/.exec(request.description ?? "");
  return Boolean(quoted && ALLOWED_BROWSER_TOOLS.has(quoted[1]));
}

export interface VerificationResult {
  status: "passed" | "failed" | "unavailable";
  summary: string;
  evidence: string[];
  provider: string;
  cases?: VerificationCase[];
}

export interface VerificationCase {
  name: string;
  steps: string[];
  expected: string;
  actual: string;
  status: "passed" | "failed" | "blocked";
}

export interface VerificationRequest {
  goal: string;
  narrative: string;
}

export interface VerificationControl {
  isCanceled(): boolean;
  onAgentCreated(agentId: string): void | Promise<void>;
  onProgress?(stage: string): void | Promise<void>;
}

function verificationToolStage(name: string): string | undefined {
  if (/browser_(?:list_tabs|new_tab)$/.test(name)) return "正在查找可用页面…";
  if (/browser_navigate$/.test(name)) return "正在打开待验证页面…";
  if (/browser_(?:snapshot|screenshot|scroll)$|cua_repl\.js|computer.*(?:snapshot|screenshot|observe)/i.test(name)) return "正在读取界面并核对实际效果…";
  if (/(?:exec_command|shell|terminal|read_file|grep|search)/i.test(name)) return "正在检查代码或运行验证命令…";
  return undefined;
}

/** A model claim alone is never evidence of an independent check. */
export function usedVerificationTool(timeline: readonly AgentTimelineItem[]): boolean {
  return timeline.some((item) => {
    if (item.type !== "tool_call" || item.status !== "completed") return false;
    const detail = item.detail as { input?: { code?: string }; output?: { structuredContent?: { ok?: boolean } } } | undefined;
    if (detail?.output?.structuredContent?.ok === false) return false;
    if (/browser_(?:list_tabs|new_tab|navigate|scroll|wait)$/.test(item.name)) return false;
    if (item.name === "cua_repl.js") return /\.(?:getAXState|domSnapshot|getScreenshot)\s*\(/.test(detail?.input?.code ?? "");
    return true;
  });
}

export async function verifyWithPaseoProvider(
  paseo: PluginHandlerContext["paseo"],
  parentAgentId: string,
  config: VerificationConfig,
  request: VerificationRequest,
  control?: VerificationControl,
  instructionTemplate = DEFAULT_VERIFICATION_PROMPT,
): Promise<VerificationResult> {
  const provider = config.model.trim() ? `${config.provider.trim()}/${config.model.trim()}` : config.provider.trim();
  if (!config.enabled || !config.provider.trim()) return { status: "unavailable", summary: "未配置验证 Provider。", evidence: [], provider };
  const parent = paseo.agents.ref(parentAgentId);
  const snapshot = parent.current() ?? (await parent.refresh())?.agent;
  if (!snapshot?.workspaceId) return { status: "unavailable", summary: "无法确定原会话所在工作区。", evidence: [], provider };
  if (control?.isCanceled()) return { status: "unavailable", summary: "验证已取消。", evidence: [], provider };

  const prompt = renderPrompt(instructionTemplate, {
    goal: request.goal, claimedResult: request.narrative,
  });

  const agent = await paseo.workspaces.ref(snapshot.workspaceId).agents.create({
    config: {
      provider,
      modeId: config.modeId.trim() || "full-access",
      ...(config.provider.trim() === "codex" && (config.modeId.trim() || "full-access") === "full-access"
        ? { options: { approval_policy: "never", sandbox_mode: "danger-full-access" } }
        : {}),
      systemPrompt: "你是独立验证员。只读检查，不得修改工作区或用户数据。",
    },
    parent: parentAgentId,
    title: VERIFIER_TITLE,
    labels: { [VERIFIER_LABEL]: "true" },
    prompt,
  });
  console.log("[vibe-review] verification agent created:", agent.id, provider);
  let unsubscribe: (() => void) | undefined;
  try {
    await control?.onAgentCreated(agent.id);
    if (control?.isCanceled()) return { status: "unavailable", summary: "验证已取消。", evidence: [], provider };
    if (control?.onProgress && agent.timeline.subscribe) {
      const subscription = agent.timeline.subscribe(({ event }) => {
        if (event.type !== "timeline" || event.item.type !== "tool_call") return;
        const stage = verificationToolStage(event.item.name);
        if (stage) void Promise.resolve(control.onProgress?.(stage)).catch((error) =>
          console.warn("[vibe-review] verification progress callback failed:", error));
      });
      unsubscribe = subscription;
      void subscription.ready.catch((error: unknown) => console.warn("[vibe-review] verification progress subscription unavailable:", error));
    }
    const waitForVerifier = () => retryAfterReconnect(
      () => agent.waitForFinish(0));
    let run = await waitForVerifier();
    for (let attempts = 0; run.status === "permission" && attempts < 12; attempts++) {
      const current = (await retryAfterReconnect(() => agent.refresh()))?.agent ?? agent.current();
      const pending = current?.pendingPermissions ?? [];
      if (pending.length === 0) {
        // The permission event may already have been answered while the run result was in flight.
        await new Promise((resolve) => setTimeout(resolve, 250));
      } else {
        const fullAccess = (config.modeId.trim() || "full-access") === "full-access";
        const blocked = fullAccess ? undefined : pending.find((request) => !isAllowedVerificationPermission(request));
        if (blocked) {
          const history = await retryAfterReconnect(() => agent.timeline.refetch({ limit: 50 }));
          const noBrowserHost = history.entries.some(({ item }) =>
            item.type === "tool_call" && (item.detail as { output?: { structuredContent?: { error?: { code?: string } } } } | undefined)?.output?.structuredContent?.error?.code === "browser_no_host");
          console.warn("[vibe-review] verification agent needs permission:", agent.id, blocked.name, "browserHostUnavailable=", noBrowserHost);
          return { status: "unavailable", summary: noBrowserHost
            ? "Paseo Browser 没有连接桌面浏览器宿主；Computer Use 需要人工授权，本次未执行。"
            : "验证 agent 请求了需要人工授权的工具，本次未自动执行。", evidence: [], provider };
        }
        for (const request of pending) {
          await retryAfterReconnect(() => agent.respondToPermission({ requestId: request.id, response: { behavior: "allow" } }));
        }
      }
      run = await waitForVerifier();
    }
    if (run.status !== "idle") return { status: "unavailable", summary: run.error || `验证任务状态：${run.status}`, evidence: [], provider };
    await control?.onProgress?.("正在整理验证结果…");
    const timeline = await retryAfterReconnect(() => agent.timeline.refetch({ limit: 200 }));
    return parseVerificationResult(timeline.entries.map(({ item }) => item), run.lastMessage ?? "", provider, agent.id);
  } finally {
    unsubscribe?.();
    await agent.archive().catch((error: unknown) => console.warn("[vibe-review] verification agent archive failed:", error));
  }
}

export async function recoverFinishedVerification(paseo: PluginHandlerContext["paseo"], verifierId: string): Promise<VerificationResult | null> {
  const agent = paseo.agents.ref(verifierId);
  const snapshot = (await agent.refresh())?.agent ?? agent.current();
  if (!snapshot || snapshot.activeTurn || snapshot.status === "running" || snapshot.pendingPermissions?.length) return null;
  const provider = snapshot.provider;
  const run = await agent.waitForFinish(1000);
  if (run.status !== "idle") return { status: "unavailable", summary: run.error || `验证任务状态：${run.status}`, evidence: [], provider };
  const timeline = await agent.timeline.refetch({ limit: 200 });
  return parseVerificationResult(timeline.entries.map(({ item }) => item), run.lastMessage ?? "", provider, verifierId);
}

function parseVerificationResult(items: readonly AgentTimelineItem[], message: string, provider: string, agentId: string): VerificationResult {
    if (!usedVerificationTool(items)) return { status: "unavailable", summary: "验证 agent 未实际使用工具检查结果。", evidence: [], provider };
    let output: { status?: string; summary?: string; evidence?: unknown; cases?: unknown };
    try {
      output = parseFirstJsonObject(message);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      console.warn("[vibe-review] verifier returned no parseable JSON:", agentId);
      return { status: "unavailable", summary: "验证 agent 已完成检查，但结果格式无法解析。请查看验证 agent 的执行记录。", evidence: [], provider };
    }
    const cases: VerificationCase[] = Array.isArray(output.cases) ? output.cases.filter((value): value is VerificationCase => {
      if (!value || typeof value !== "object") return false;
      const item = value as Partial<VerificationCase>;
      return typeof item.name === "string" && Boolean(item.name.trim())
        && Array.isArray(item.steps) && item.steps.length > 0 && item.steps.every((step) => typeof step === "string" && Boolean(step.trim()))
        && typeof item.expected === "string" && Boolean(item.expected.trim())
        && typeof item.actual === "string" && Boolean(item.actual.trim())
        && (item.status === "passed" || item.status === "failed" || item.status === "blocked");
    }).map((item) => ({
      name: item.name, steps: item.steps,
      expected: item.expected, actual: item.actual, status: item.status,
    })) : [];
    let status: VerificationResult["status"] = output.status === "passed" || output.status === "failed" ? output.status : "unavailable";
    if (cases.some((item) => item.status === "failed")) status = "failed";
    else if (cases.some((item) => item.status === "blocked")) status = "unavailable";
    else if (status === "passed" && (cases.length === 0 || cases.some((item) => item.status !== "passed"))) status = "unavailable";
    const evidence = Array.isArray(output.evidence)
      ? output.evidence.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
      : [];
    if (status !== "unavailable" && evidence.length === 0) {
      return { status: "unavailable", summary: "验证 agent 未提供实际观察证据。", evidence, provider };
    }
    return { status, summary: output.summary || "验证未提供结论。", evidence, provider, cases };
}
