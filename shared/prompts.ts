import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

const REVIEW_CONTEXT = [
  "<user_messages>\n{{userMessages}}\n</user_messages>",
  "<assistant_messages>\n{{assistantMessages}}\n</assistant_messages>",
  "{{changedFiles}}", "{{diffWarning}}",
  "<interruption_signals>\n{{interruptionSignals}}\n</interruption_signals>",
  '固定输出格式（六个字段，冒号后用英文半角冒号+空格）：\ngoal: ...\ndrifts: ...\nnarrative: ...\nresult: ...\ntask_type: ...\nfollowups: ["..."]',
].join("\n\n");

const VERIFICATION_CONTEXT = [
  "只读检查，禁止修改文件、发送消息、提交或执行破坏性操作。",
  '只输出一个 JSON 对象：{"status":"passed|failed|unavailable","summary":"简短结论","evidence":["实际观察到的事实"],"cases":[{"name":"用例名称","steps":["实际执行的步骤"],"expected":"预期结果","actual":"实际结果及证据","status":"passed|failed|blocked"}]}。有用例失败则总体 failed；关键用例受阻且无法判断则 unavailable；所有关键用例通过才 passed。',
  "<goal>\n{{goal}}\n</goal>", "<claimed_result>\n{{claimedResult}}\n</claimed_result>",
  "<assistant_messages>\n{{assistantMessages}}\n</assistant_messages>", "{{changedFiles}}",
].join("\n\n");

const PI_CONTEXT = [
  "此阶段只生成预览，绝不执行提交或修改文件。",
  '只输出一个 JSON 对象：{"message":"不超过80字的单行提交标题","files":["相对路径"]}。files 只能从下方候选路径中选择，不要包含 .DS_Store。',
  "{{styleHint}}", "{{recentMessages}}", "候选路径：\n{{candidateFiles}}", "{{reviewContext}}",
  "当前待提交 diff：\n{{diff}}", "{{diffWarning}}",
].join("\n\n");

export const DEFAULT_REVIEW_PROMPT = [
  "你是对话审核助手。总结这轮任务、agent 执行过程和结果。只陈述事实，不凭空推断。",
  "goal：结合最近几轮上下文，概括用户真正要解决的问题。",
  "drifts：指出与目标无关的改动，没有则写无。",
  "narrative：说明任务、实际操作、结果、错误及是否修复、正常交付还是中断。",
  "result：根据完成程度选择 done、partial、none 或 unknown。",
  "task_type：可独立检查的结果选 verification_required；只是回答且无文件改动选 simple_reply；其余选 other。有文件改动不能选 simple_reply。",
  "followups：基于事实给出用户可发送的下一步问题。优先只给最有价值的 1 条，最多三条；不重复已完成任务，不建议提交代码。",
  "", REVIEW_CONTEXT,
].join("\n");
export const DEFAULT_VERIFICATION_PROMPT = [
  "请独立验证本轮声称的结果。先根据可验证主张和主要风险设计少量具体测试用例，每例写明操作步骤与可观察的预期结果。",
  "按用例执行，记录实际结果及通过、失败或受阻状态。界面可检查页面及可访问性树，必要时截图；代码质量可检查实际改动和上下文；功能行为可运行适当测试或实际操作。按任务选择方法。",
  "以工具取得的一手观察为依据，区分事实和推测。不能只凭 agent 自述判通过；关键用例受阻时说明未覆盖内容。",
  "", VERIFICATION_CONTEXT,
].join("\n");
export const DEFAULT_PI_COMMIT_PROMPT = [
  "请为当前改动拟定 Git commit 标题，并选择属于同一提交的文件。标题参照本仓库近期提交的语言、type 前缀和简洁程度，概括改动目的。",
  "不要列举文件和功能清单，也不要写操作过程。近期审核分析仅帮助理解目的，若与实际 diff 冲突，以 diff 为准。",
  "", PI_CONTEXT,
].join("\n");

const required = {
  review: ["userMessages", "assistantMessages", "changedFiles", "interruptionSignals"],
  verification: ["goal", "claimedResult", "assistantMessages", "changedFiles"],
  piCommit: ["candidateFiles", "diff", "recentMessages", "reviewContext"],
} as const;
export type PromptKind = keyof typeof required;
export function missingPromptVariables(kind: PromptKind, template: string): string[] {
  return required[kind].filter((name) => !template.includes(`{{${name}}}`));
}
export function renderPrompt(template: string, variables: Record<string, string>): string {
  return template.replace(/{{([A-Za-z][A-Za-z0-9]*)}}/g, (match, key: string) => Object.hasOwn(variables, key) ? variables[key] : match);
}

// Preserve instruction-only settings written by v1 while adding editable variable positions.
function migrateInstruction(kind: PromptKind, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return { review: DEFAULT_REVIEW_PROMPT, verification: DEFAULT_VERIFICATION_PROMPT, piCommit: DEFAULT_PI_COMMIT_PROMPT }[kind];
  if (missingPromptVariables(kind, value).length === 0) return value;
  return `${value}\n\n${{ review: REVIEW_CONTEXT, verification: VERIFICATION_CONTEXT, piCommit: PI_CONTEXT }[kind]}`;
}
export const promptTemplateSchema = z.object({
  review: z.string().trim().min(1).max(30000).refine((value) => missingPromptVariables("review", value).length === 0, "缺少必需变量").default(DEFAULT_REVIEW_PROMPT),
  verification: z.string().trim().min(1).max(30000).refine((value) => missingPromptVariables("verification", value).length === 0, "缺少必需变量").default(DEFAULT_VERIFICATION_PROMPT),
  piCommit: z.string().trim().min(1).max(30000).refine((value) => missingPromptVariables("piCommit", value).length === 0, "缺少必需变量").default(DEFAULT_PI_COMMIT_PROMPT),
});
export type PromptTemplates = z.infer<typeof promptTemplateSchema>;
export const promptTemplateSettings = defineSettings({
  id: "vibe-review-prompt-templates", scope: "host", version: 2, schema: promptTemplateSchema,
  migrate: (values) => {
    const old = values as Partial<Record<PromptKind, unknown>>;
    return { review: migrateInstruction("review", old.review), verification: migrateInstruction("verification", old.verification), piCommit: migrateInstruction("piCommit", old.piCommit) };
  },
});
