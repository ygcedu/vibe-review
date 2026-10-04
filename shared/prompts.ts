import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

const REVIEW_SEGMENTS = [
  "<user_messages>\n{{userMessages}}\n</user_messages>",
  "<assistant_messages>\n{{assistantMessages}}\n</assistant_messages>",
  "{{changedFiles}}", "{{diffWarning}}",
  "<interruption_signals>\n{{interruptionSignals}}\n</interruption_signals>",
  '固定输出格式（六个字段，冒号后用英文半角冒号+空格）：\ngoal: ...\ndrifts: ...\nnarrative: ...\nresult: ...\ntask_type: ...\nfollowups: ["..."]',
];
export const REVIEW_CONTEXT = REVIEW_SEGMENTS.join("\n");

const VERIFICATION_SEGMENTS = [
  "只读检查，禁止修改文件、发送消息、提交或执行破坏性操作。",
  '只输出 JSON：{"status":"passed|failed|unavailable","summary":"结论","evidence":["观察到的事实"],"cases":[{"name":"用例","steps":["执行的步骤"],"expected":"预期","actual":"实际结果和证据","status":"passed|failed|blocked"}]}。有失败则 failed；关键用例受阻且无法判断则 unavailable；全部关键用例通过才 passed。',
  "用户目标：\n{{goal}}", "声称完成的结果：\n{{claimedResult}}",
];
const LEGACY_VERIFICATION_SEGMENTS = [
  "只读检查，禁止修改文件、发送消息、提交或执行破坏性操作。",
  '只输出一个 JSON 对象：{"status":"passed|failed|unavailable","summary":"简短结论","evidence":["实际观察到的事实"],"cases":[{"name":"用例名称","steps":["实际执行的步骤"],"expected":"预期结果","actual":"实际结果及证据","status":"passed|failed|blocked"}]}。有用例失败则总体 failed；关键用例受阻且无法判断则 unavailable；所有关键用例通过才 passed。',
  "<goal>\n{{goal}}\n</goal>", "<claimed_result>\n{{claimedResult}}\n</claimed_result>",
  "<assistant_messages>\n{{assistantMessages}}\n</assistant_messages>", "{{changedFiles}}",
];
export const VERIFICATION_CONTEXT = VERIFICATION_SEGMENTS.join("\n");

const PI_SEGMENTS = [
  "此阶段只生成预览，绝不执行提交或修改文件。",
  '只输出一个 JSON 对象：{"message":"不超过80字的单行提交标题","files":["相对路径"]}。files 只能从下方候选路径中选择，不要包含 .DS_Store。',
  "{{styleHint}}", "{{recentMessages}}", "候选路径：\n{{candidateFiles}}", "{{reviewContext}}",
  "当前待提交 diff：\n{{diff}}", "{{diffWarning}}",
];
export const PI_CONTEXT = PI_SEGMENTS.join("\n");

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
  "根据用户目标和声称结果，选少量关键用例独立验证。先写清每例的操作和预期，再实际执行；按任务需要检查界面、运行测试或操作功能。",
  "只用亲自观察到的结果判断是否通过。无法检查时说明受阻原因和未验证的部分。",
  "", VERIFICATION_CONTEXT,
].join("\n");
export const DEFAULT_PI_COMMIT_PROMPT = [
  "请为当前改动拟定 Git commit 标题，并选择属于同一提交的文件。标题参照本仓库近期提交的语言、type 前缀和简洁程度，概括改动目的。",
  "不要列举文件和功能清单，也不要写操作过程。近期审核分析仅帮助理解目的，若与实际 diff 冲突，以 diff 为准。",
  "", PI_CONTEXT,
].join("\n");

const required = {
  review: ["userMessages", "assistantMessages", "changedFiles", "interruptionSignals"],
  verification: ["goal", "claimedResult"],
  piCommit: ["candidateFiles", "diff", "recentMessages", "reviewContext"],
} as const;
export type PromptKind = keyof typeof required;
const fixedParts = { review: REVIEW_CONTEXT, verification: VERIFICATION_CONTEXT, piCommit: PI_CONTEXT } as const;
const fixedSegments = {
  review: REVIEW_SEGMENTS,
  verification: VERIFICATION_SEGMENTS,
  piCommit: PI_SEGMENTS,
} as const;
export function promptFixedPart(kind: PromptKind): string { return fixedParts[kind]; }
export function promptFixedSegments(kind: PromptKind): readonly string[] { return fixedSegments[kind]; }
export function promptEditableParts(kind: PromptKind, template: string): string[] | null {
  const parts: string[] = [];
  let position = 0;
  for (const segment of fixedSegments[kind]) {
    const next = template.indexOf(segment, position);
    if (next < 0) return null;
    parts.push(template.slice(position, next));
    position = next + segment.length;
  }
  parts.push(template.slice(position));
  return parts;
}
export function composePromptTemplate(kind: PromptKind, editable: readonly string[]): string {
  const segments = fixedSegments[kind];
  if (editable.length !== segments.length + 1) throw new Error("提示词可编辑区域数量不匹配");
  return segments.reduce((result, segment, index) => result + segment + editable[index + 1], editable[0]);
}
export function missingPromptVariables(kind: PromptKind, template: string): string[] {
  return required[kind].filter((name) => !template.includes(`{{${name}}}`));
}
export function renderPrompt(template: string, variables: Record<string, string>): string {
  return template.replace(/{{([A-Za-z][A-Za-z0-9]*)}}/g, (match, key: string) => Object.hasOwn(variables, key) ? variables[key] : match);
}

// Preserve instruction-only settings written by v1 while adding editable variable positions.
function migrateInstruction(kind: PromptKind, value: unknown, fromVersion: number): string {
  if (typeof value !== "string" || !value.trim()) return { review: DEFAULT_REVIEW_PROMPT, verification: DEFAULT_VERIFICATION_PROMPT, piCommit: DEFAULT_PI_COMMIT_PROMPT }[kind];
  if (kind === "verification" && fromVersion < 6 && !promptEditableParts(kind, value)) {
    let remainder = value;
    const custom: string[] = [];
    for (const segment of LEGACY_VERIFICATION_SEGMENTS) {
      const index = remainder.indexOf(segment);
      if (index < 0) { custom.length = 0; break; }
      custom.push(remainder.slice(0, index));
      remainder = remainder.slice(index + segment.length);
    }
    if (custom.length) {
      custom.push(remainder);
      const instruction = custom.join("\n").trim();
      if (instruction.startsWith("请独立验证本轮声称的结果。先根据可验证主张和主要风险设计少量具体测试用例") && instruction.includes("以工具取得的一手观察为依据，区分事实和推测。")) return DEFAULT_VERIFICATION_PROMPT;
      return instruction ? `${instruction}\n\n${VERIFICATION_CONTEXT}` : DEFAULT_VERIFICATION_PROMPT;
    }
  }
  const parts = promptEditableParts(kind, value);
  if (parts) {
    if (fromVersion >= 5) return value;
    return composePromptTemplate(kind, parts.map((part, index) => index > 0 && index < parts.length - 1 && part === "\n\n" ? "\n" : part));
  }
  // Keep any earlier custom text, even when it changed the old dynamic section.
  return composePromptTemplate(kind, [`${value.trim()}\n\n`, ...fixedSegments[kind].slice(1).map(() => "\n"), ""]);
}
export const promptTemplateSchema = z.object({
  review: z.string().min(1).max(30000).refine((value) => promptEditableParts("review", value) !== null, "固定部分不能修改").default(DEFAULT_REVIEW_PROMPT),
  verification: z.string().min(1).max(30000).refine((value) => promptEditableParts("verification", value) !== null, "固定部分不能修改").default(DEFAULT_VERIFICATION_PROMPT),
  piCommit: z.string().min(1).max(30000).refine((value) => promptEditableParts("piCommit", value) !== null, "固定部分不能修改").default(DEFAULT_PI_COMMIT_PROMPT),
});
export type PromptTemplates = z.infer<typeof promptTemplateSchema>;
export const promptTemplateSettings = defineSettings({
  id: "vibe-review-prompt-templates", scope: "host", version: 6, schema: promptTemplateSchema,
  migrate: (values, fromVersion) => {
    const old = values as Partial<Record<PromptKind, unknown>>;
    return { review: migrateInstruction("review", old.review, fromVersion), verification: migrateInstruction("verification", old.verification, fromVersion), piCommit: migrateInstruction("piCommit", old.piCommit, fromVersion) };
  },
});
