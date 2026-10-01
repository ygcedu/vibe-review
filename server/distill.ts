import type { LlmConfig } from "../shared/settings";

/** 解析 LLM 的四行文本（goal/drifts/narrative/result），容错全角冒号、ASCII 冒号与多余空行。 */
function parseDistillText(text: string): { goal: string; drifts: string; narrative: string; result: string } {
  // 全角冒号在 key 位置归一成 ASCII，让 grab 只处理一种冒号
  const norm = text.replace(/\r/g, "").replace(/([A-Za-z]+)：/g, "$1:");
  const grab = (key: string, nextKey?: string): string => {
    // 抓 "key:" 之后到下一个 "nextKey:" 或文本结尾之间的内容
    const startIdx = norm.indexOf(`${key}:`);
    if (startIdx < 0) return "";
    let endIdx = norm.length;
    if (nextKey) {
      const nextIdx = norm.indexOf(`${nextKey}:`, startIdx + key.length);
      if (nextIdx > startIdx) endIdx = nextIdx;
    }
    return norm.slice(startIdx + key.length + 1, endIdx).trim();
  };
  return {
    goal: grab("goal", "drifts"),
    drifts: grab("drifts", "narrative"),
    narrative: grab("narrative", "result"),
    result: grab("result"),
  };
}

export interface DistilledTask {
  /** 最近一轮用户真正要解决的问题。 */
  goal: string;
  /** 偏离目标的修改（与任务无关的改动），没有则为空。 */
  drifts: string[];
  /** 一段人话：要干什么 → 怎么做的 → 结果如何。 */
  narrative: string;
  /** 本轮最终结果：done（正常交付）/ partial（部分完成）/ none（未完成/中断）。 */
  result: "done" | "partial" | "none" | "unknown";
  /** 发给 LLM 的提示词。 */
  prompt: string;
  /** 展示用：同 prompt，但去掉 diff 原文一节（卡片展开详情）。 */
  promptNoDiff: string;
}

export function buildDistillPrompt(
  userMessages: string[],
  assistantMessages: string[],
  lastTurnDiff?: string,
  runningTools = 0,
  turnOutcome?: { kind: string; error?: { message?: string } },
  diffIncomplete = false,
): string {
  const signals: string[] = [];
  if (runningTools > 0) signals.push(`agent 断开时有 ${runningTools} 个工具调用停在 running、无最终答复 —— 属于异常中断，result 必须填 none`);
  if (turnOutcome?.kind === "failed") signals.push(`本轮 turn 结局为 failed（${turnOutcome.error?.message ?? "未知错误"}），result 必须填 none`);
  if (turnOutcome?.kind === "canceled") signals.push("本轮 turn 被取消，若目标未完成 result 填 none");

  const assistantText = assistantMessages.join("\n");

  return [
    "你是对话审核助手。总结这轮任务、agent 执行过程和结果。严格按下面的固定格式输出四行，不要 JSON、不要 markdown、不要其它解释：",
    "goal: 结合最近几轮上下文，最新一条用户消息里用户真正要解决什么问题（1 句话，≤40 字）",
    "drifts: agent 做了哪些与目标无关的改动（逗号分隔，没有则写 无）",
    "narrative: 4-6 句中文客观描述「这轮要解决什么 → agent 具体做了什么（改了哪些文件、跑了什么命令）→ 结果如何 → 中间遇到哪些报错/失败、是否修复 → 结束时是正常交付还是中断」，只陈述事实不评价",
    "result: 本轮最终结果，只填一个词：done（正常交付、目标达成）/ partial（部分完成，还有遗漏）/ none（未完成、异常中断或 agent 断开未回复）；信息不足填 unknown",
    "",
    "<user_messages>",
    userMessages.map((m, i) => `${i + 1}. ${m}`).join("\n") || "(无)",
    "</user_messages>",
    "",
    "<assistant_messages>",
    assistantText || "(无)",
    "</assistant_messages>",
    "",
    ...(lastTurnDiff !== undefined ? ["<changed_files>", lastTurnDiff || "(无记录)", "</changed_files>", ""] : []),
    ...(diffIncomplete ? ["文件变更可能不完整。", ""] : []),
    "<interruption_signals>",
    signals.join("；") || "(未检测到)",
    "</interruption_signals>",
    "",
    '固定输出格式（四行，冒号后用英文半角冒号+空格）：',
    'goal: ...',
    'drifts: ...',
    'narrative: ...',
    'result: ...',
  ].join("\n");
}

export async function distillTask(
  config: LlmConfig,
  userMessages: string[],
  assistantMessages: string[],
  extra?: {
    lastTurnDiff?: string;
    runningTools?: number;
    turnOutcome?: { kind: string; error?: { message?: string } };
    diffIncomplete?: boolean;
  },
): Promise<DistilledTask> {
  const prompt = buildDistillPrompt(
    userMessages,
    assistantMessages,
    extra?.lastTurnDiff,
    extra?.runningTools ?? 0,
    extra?.turnOutcome,
    extra?.diffIncomplete ?? false,
  );
  // 卡片展开详情：重新生成一份不含 changed_files 块的提示词，避免用正则去抠 diff 内容
  // （diff 里可能含有 </changed_files> 等字面量，正则不可靠）。
  const promptNoDiff = buildDistillPrompt(
    userMessages,
    assistantMessages,
    undefined,
    extra?.runningTools ?? 0,
    extra?.turnOutcome,
    extra?.diffIncomplete ?? false,
  );

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 500,
      temperature: 0.1,
    }),
  });
  if (!res.ok) throw new Error(`LLM distill HTTP ${res.status}`);
  const raw = await res.text();
  // Response body may be truncated by SSE residue; take only the first JSON object.
  const data = JSON.parse(raw.slice(0, raw.indexOf("data:")) || raw) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  const fields = parseDistillText(text);
  if (!fields.goal && !fields.narrative) {
    return {
      goal: userMessages[userMessages.length - 1]?.slice(0, 60) || "完成用户任务",
      drifts: [],
      narrative: "",
      result: "unknown",
      prompt,
      promptNoDiff,
    };
  }
  const goal = fields.goal.slice(0, 80) || userMessages[userMessages.length - 1]?.slice(0, 60) || "完成用户任务";
  const drifts = fields.drifts
    .split(/[,，]/)
    .map((s) => s.trim().slice(0, 80))
    .filter((s) => s && s !== "无" && s !== "none");
  const rawResult = fields.result.toLowerCase().trim();
  const result: DistilledTask["result"] =
    rawResult === "done" ? "done" : rawResult === "partial" ? "partial" : rawResult === "none" ? "none" : "unknown";
  return {
    goal,
    drifts,
    narrative: fields.narrative,
    result,
    prompt,
    promptNoDiff,
  };
}
