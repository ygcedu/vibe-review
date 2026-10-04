import type { AgentPermissionRequest, AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { VerificationConfig } from "../shared/settings";
import { parseFirstJsonObject } from "./llm-response.ts";

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

async function retryAfterReconnect<T>(operation: () => Promise<T>, deadline: number): Promise<T> {
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransportDisconnect(error)) throw error;
      if (Date.now() >= deadline) throw new Error("与 Paseo 的连接持续中断，未能取得验证结果。", { cause: error });
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
}

export interface VerificationRequest {
  goal: string;
  narrative: string;
  assistantMessages: string[];
  diff?: string;
}

export interface VerificationControl {
  isCanceled(): boolean;
  onAgentCreated(agentId: string): void | Promise<void>;
}

/** A model claim alone is never evidence of a browser/computer check. */
export function usedVerificationTool(timeline: readonly AgentTimelineItem[]): boolean {
  return timeline.some((item) => {
    if (item.type !== "tool_call" || item.status !== "completed") return false;
    const detail = item.detail as { input?: { code?: string }; output?: { structuredContent?: { ok?: boolean } } } | undefined;
    if (detail?.output?.structuredContent?.ok === false) return false;
    if (/browser_(?:snapshot|screenshot)$/.test(item.name)) return true;
    if (item.name === "cua_repl.js") return /\.(?:getAXState|domSnapshot|getScreenshot)\s*\(/.test(detail?.input?.code ?? "");
    return /computer(?:_use)?[._-]?(?:screenshot|snapshot|observe)/i.test(item.name);
  });
}

export async function verifyWithPaseoProvider(
  paseo: PluginHandlerContext["paseo"],
  parentAgentId: string,
  config: VerificationConfig,
  request: VerificationRequest,
  control?: VerificationControl,
): Promise<VerificationResult> {
  const provider = config.model.trim() ? `${config.provider.trim()}/${config.model.trim()}` : config.provider.trim();
  if (!config.enabled || !config.provider.trim()) return { status: "unavailable", summary: "未配置验证 Provider。", evidence: [], provider };
  const parent = paseo.agents.ref(parentAgentId);
  const snapshot = parent.current() ?? (await parent.refresh())?.agent;
  if (!snapshot?.workspaceId) return { status: "unavailable", summary: "无法确定原会话所在工作区。", evidence: [], provider };
  if (control?.isCanceled()) return { status: "unavailable", summary: "验证已取消。", evidence: [], provider };

  const prompt = [
    "请独立验证下述任务本轮声称的结果。只读检查，禁止修改文件、发送消息、提交或执行破坏性操作。",
    "必须使用 Paseo Browser 工具或 Provider 可用的 Computer Use 工具检查实际界面；先列出/打开相关页面，再读取 DOM/可访问性树，必要时才截图。",
    "若 Paseo Browser 没有连接的浏览器宿主，请尝试 Computer Use；两者都不可用才返回 unavailable。不能凭文字推断 passed。",
    "只输出一个 JSON 对象：{\"status\":\"passed|failed|unavailable\",\"summary\":\"简短结论\",\"evidence\":[\"实际观察到的事实\"]}。",
    "<goal>", request.goal, "</goal>",
    "<claimed_result>", request.narrative, "</claimed_result>",
    "<assistant_messages>", request.assistantMessages.join("\n"), "</assistant_messages>",
    ...(request.diff ? ["<changed_files>", request.diff, "</changed_files>"] : []),
  ].join("\n");

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
  try {
    await control?.onAgentCreated(agent.id);
    if (control?.isCanceled()) return { status: "unavailable", summary: "验证已取消。", evidence: [], provider };
    const deadline = Date.now() + 6 * 60_000;
    const waitForVerifier = () => retryAfterReconnect<any>(
      () => agent.waitForFinish(Math.max(1, deadline - Date.now())), deadline);
    let run = await waitForVerifier();
    for (let attempts = 0; run.status === "permission" && attempts < 12 && Date.now() < deadline; attempts++) {
      const current = (await retryAfterReconnect<any>(() => agent.refresh(), deadline))?.agent ?? agent.current();
      const pending = current?.pendingPermissions ?? [];
      if (pending.length === 0) {
        // The permission event may already have been answered while the run result was in flight.
        await new Promise((resolve) => setTimeout(resolve, 250));
      } else {
        const fullAccess = (config.modeId.trim() || "full-access") === "full-access";
        const blocked = fullAccess ? undefined : pending.find((request: AgentPermissionRequest) => !isAllowedVerificationPermission(request));
        if (blocked) {
          const history = await retryAfterReconnect<any>(() => agent.timeline.refetch({ limit: 50 }), deadline);
          const noBrowserHost = history.entries.some(({ item }: { item: AgentTimelineItem }) =>
            item.type === "tool_call" && (item.detail as { output?: { structuredContent?: { error?: { code?: string } } } } | undefined)?.output?.structuredContent?.error?.code === "browser_no_host");
          console.warn("[vibe-review] verification agent needs permission:", agent.id, blocked.name, "browserHostUnavailable=", noBrowserHost);
          return { status: "unavailable", summary: noBrowserHost
            ? "Paseo Browser 没有连接桌面浏览器宿主；Computer Use 需要人工授权，本次未执行。"
            : "验证 agent 请求了需要人工授权的工具，本次未自动执行。", evidence: [], provider };
        }
        for (const request of pending) {
          await retryAfterReconnect(() => agent.respondToPermission({ requestId: request.id, response: { behavior: "allow" } }), deadline);
        }
      }
      run = await waitForVerifier();
    }
    if (run.status !== "idle") return { status: "unavailable", summary: run.error || `验证任务状态：${run.status}`, evidence: [], provider };
    const timeline = await retryAfterReconnect<any>(() => agent.timeline.refetch({ limit: 200 }), deadline);
    const items = timeline.entries.map((entry: { item: AgentTimelineItem }) => entry.item);
    if (!usedVerificationTool(items)) return { status: "unavailable", summary: "验证 agent 未实际调用 Browser 或 Computer 观察工具。", evidence: [], provider };
    const output = parseFirstJsonObject<{ status?: string; summary?: string; evidence?: unknown }>(run.lastMessage ?? "");
    const status = output.status === "passed" || output.status === "failed" ? output.status : "unavailable";
    const evidence = Array.isArray(output.evidence)
      ? output.evidence.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).slice(0, 5).map((value) => value.slice(0, 400))
      : [];
    if (status !== "unavailable" && evidence.length === 0) {
      return { status: "unavailable", summary: "验证 agent 未提供实际观察证据。", evidence, provider };
    }
    return { status, summary: (output.summary || "验证未提供结论。").slice(0, 400), evidence, provider };
  } finally {
    await agent.archive().catch((error: unknown) => console.warn("[vibe-review] verification agent archive failed:", error));
  }
}
