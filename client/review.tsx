import type { ComponentType } from "react";
import { View, Text, StyleSheet, TouchableOpacity, useColorScheme } from "react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePaseo, useRpc, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { output } from "zod";
import { reviewResultSchema } from "../shared/review";
import { parseDiffFiles } from "./diff";
import { FileTree } from "./file-tree";
import { copyText } from "@getpaseo/plugin/client/react-native";
import { fillVisibleComposer } from "./composer-fill";
import { commitAvailabilityRpc, preparePiCommitRpc, piCommitStatusRpc, getPendingCommitDiffRpc } from "../shared/commit";

type ReviewResultData = output<typeof reviewResultSchema>;

const verdictStyle = {
  pass: { accent: "#15803d", darkAccent: "#86efac", tint: "#dcfce7", darkTint: "#153d29", label: "通过" },
  review: { accent: "#b45309", darkAccent: "#fcd34d", tint: "#fef3c7", darkTint: "#493018", label: "需复核" },
  reject: { accent: "#b91c1c", darkAccent: "#fca5a5", tint: "#fee2e2", darkTint: "#491f20", label: "偏离目标" },
} as const;

const driftLabel = {
  in_scope: "在范围内",
  minor_drift: "轻微偏离",
  major_drift: "明显偏离",
} as const;

const resultLabel = {
  done: "已完成",
  partial: "部分完成",
  none: "未完成",
  unknown: "无法判断",
} as const;

const taskTypeLabel = {
  verification_required: "待验证",
  simple_reply: "简单回复",
  other: "其他任务",
} as const;

const verificationLabel = { passed: "验证通过", failed: "验证未通过", unavailable: "未能验证" } as const;

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

const commitSteps = ["读取改动", "等待模型", "生成建议", "整理预览"];
function commitStep(stage: string): number {
  if (stage.includes("整理")) return 3;
  if (stage.includes("模型已开始") || stage.includes("模型正在")) return 2;
  if (stage.includes("Pi") || stage.includes("等待模型")) return 1;
  return 0;
}

export const ReviewResultItem: ComponentType<PluginTimelineItemProps<ReviewResultData>> = (
  props,
) => {
  const { data } = props.item;
  const v = verdictStyle[data.verdict];
  const dark = useColorScheme() === "dark";
  const accent = dark ? v.darkAccent : v.accent;
  const cardColors = dark
    ? { background: "#1f2937", border: "#374151", text: "#f3f4f6", muted: "#a9b3c2", divider: "#374151" }
    : { background: "#ffffff", border: "#d8dee6", text: "#111827", muted: "#6b7280", divider: "#e5e7eb" };
  const drift = driftLabel[data.drift as keyof typeof driftLabel] ?? data.drift;
  const [expanded, setExpanded] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [followupFeedback, setFollowupFeedback] = useState("");
  const [commitCwd, setCommitCwd] = useState<string | null>(null);
  const [commitTargetCwd, setCommitTargetCwd] = useState<string | null>(null);
  const [commitRunning, setCommitRunning] = useState(false);
  const [commitProgress, setCommitProgress] = useState<{ kind: "preparing" | "ready" | "failed"; stage: string; startedAt: number } | null>(null);
  const [pendingDiff, setPendingDiff] = useState<string | null>(null);
  const superseded = useRef(false);
  const paseo = usePaseo();
  const pendingDiffRequested = useRef(false);
  const checkCommit = useRpc(commitAvailabilityRpc);
  const checkCommitRef = useRef(checkCommit);
  checkCommitRef.current = checkCommit;
  const preparePiCommit = useRpc(preparePiCommitRpc);
  const getCommitStatus = useRpc(piCommitStatusRpc);
  const getCommitStatusRef = useRef(getCommitStatus);
  getCommitStatusRef.current = getCommitStatus;
  const getPendingDiff = useRpc(getPendingCommitDiffRpc);
  const getPendingDiffRef = useRef(getPendingDiff);
  getPendingDiffRef.current = getPendingDiff;
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void checkCommitRef.current({ agentId: props.agentId, scoredAt: data.scoredAt }).then(
        (result) => { if (active) setCommitCwd(!superseded.current && result.available ? result.cwd ?? null : null); },
        () => { if (active) setCommitCwd(null); },
      );
    };
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, [props.agentId, data.scoredAt]);
  useEffect(() => {
    if (!commitCwd) return;
    const subscription = paseo.agents.ref(props.agentId).timeline.subscribe(({ event }: { event: { type: string; item?: { type: string } } }) => {
      if (event.type === "turn_started" || (event.type === "timeline" && event.item?.type === "user_message")) {
        superseded.current = true;
        setCommitCwd(null);
        setCommitTargetCwd(null);
        setCommitProgress(null);
      }
    });
    void subscription.ready.catch(() => {});
    return () => { subscription(); };
  }, [paseo, props.agentId, Boolean(commitCwd)]);
  useEffect(() => {
    // The start RPC installs server status before it resolves. Polling earlier
    // can observe idle and falsely report an interrupted preview.
    if (commitRunning || commitProgress?.kind !== "preparing") return;
    let active = true;
    const refresh = () => {
      void getCommitStatusRef.current({ agentId: props.agentId }).then((status) => {
        if (!active) return;
        if (status.kind === "idle") {
          setCommitProgress((current) => current?.kind === "preparing"
            ? { kind: "failed", stage: "预览任务已中断，请重试。", startedAt: current.startedAt }
            : null);
          setPendingDiff(null);
        } else {
          const next = { kind: status.kind, stage: status.stage, startedAt: status.startedAt ?? Date.now() };
          setCommitProgress((current) => {
            if (current && next.startedAt < current.startedAt) return current;
            if (current?.kind === next.kind && current.stage === next.stage && current.startedAt === next.startedAt) return current;
            return next;
          });
          if (status.diffReady && !pendingDiffRequested.current) {
            pendingDiffRequested.current = true;
            void getPendingDiffRef.current({ agentId: props.agentId }).then(
              (result) => { if (active) setPendingDiff(result.diff); },
              () => { pendingDiffRequested.current = false; },
            );
          }
        }
      }, (error: unknown) => {
        if (active) setCommitProgress({ kind: "failed", stage: error instanceof Error ? error.message : String(error), startedAt: Date.now() });
      });
    };
    refresh();
    const timer = setInterval(refresh, 2_000);
    return () => { active = false; clearInterval(timer); };
  }, [props.agentId, commitRunning, commitProgress?.kind]);
  const diffFiles = parseDiffFiles(data.diff);
  const totalAdded = diffFiles.reduce((total, file) => total + file.added, 0);
  const totalRemoved = diffFiles.reduce((total, file) => total + file.removed, 0);
  const followups = data.followups ?? [];
  const otherFollowups = commitCwd ? followups.filter((suggestion) => !/提交|commit/i.test(suggestion)) : followups;
  const visibleFollowups = (otherFollowups.length ? otherFollowups : followups).slice(0, commitCwd ? 2 : 3);
  const pendingDiffFiles = useMemo(() => pendingDiff ? parseDiffFiles(pendingDiff) : [], [pendingDiff]);
  const hasAnalysis = Boolean(data.narrative || data.summary || data.drifts?.length || data.verification?.evidence.length || data.verification?.summary || data.detail);

  const useFollowup = (suggestion: string) => {
    if (props.layout.platform === "web") {
      setFollowupFeedback(fillVisibleComposer(suggestion) ? "已填入输入框" : "无法确定当前输入框，请先关闭其他会话分栏。" );
      return;
    }
    void copyText(suggestion).then(
      () => setFollowupFeedback("已复制追问，请粘贴到输入框。"),
      () => setFollowupFeedback("复制失败，请长按文字复制。"),
    );
  };

  const startCommit = () => {
    const cwd = commitCwd ?? commitTargetCwd;
    if (!cwd || superseded.current || commitRunning || commitProgress?.kind === "preparing") return;
    setCommitTargetCwd(cwd);
    setPendingDiff(null);
    pendingDiffRequested.current = false;
    setCommitRunning(true);
    setCommitProgress({ kind: "preparing", stage: "正在启动 Pi…", startedAt: Date.now() });
    void preparePiCommit({ agentId: props.agentId, cwd, scoredAt: data.scoredAt }).then(
      () => setCommitCwd(null),
      (error: unknown) => setCommitProgress({ kind: "failed", stage: `无法启动 Pi：${error instanceof Error ? error.message : String(error)}`, startedAt: Date.now() }),
    ).finally(() => setCommitRunning(false));
  };

  return (
    <View style={styles.reviewGroup}>
    <View style={[styles.container, { backgroundColor: cardColors.background, borderColor: cardColors.border }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: accent, backgroundColor: dark ? v.darkTint : v.tint }]}>
          {v.label}
        </Text>
        <Text style={[styles.time, { color: cardColors.muted }]}>
          {formatTime(data.scoredAt)}
        </Text>
      </View>
      {data.goal ? (
        <Text numberOfLines={2} style={[styles.goal, { color: cardColors.text }]}>
          {data.goal}
        </Text>
      ) : null}
      <View style={styles.statusRow}>
        {data.result ? (
          <Text style={[styles.stat, { color: cardColors.muted }]}>
            {resultLabel[data.result]}
          </Text>
        ) : (
          <Text style={[styles.stat, { color: cardColors.muted }]}>
            完成度 {Math.round(data.completed * 100)}%
          </Text>
        )}
        {data.drift !== "in_scope" ? <Text style={[styles.stat, { color: accent }]}>{drift}</Text> : null}
        {data.taskType === "verification_required" && !data.verification
          ? <Text style={[styles.stat, { color: cardColors.muted }]}>{taskTypeLabel[data.taskType]}</Text> : null}
        {data.verification ? <Text style={[styles.stat, { color: data.verification.status === "passed" ? (dark ? "#86efac" : "#15803d") : accent }]}>
          {verificationLabel[data.verification.status]}
        </Text> : null}
      </View>
      {hasAnalysis ? <TouchableOpacity style={[styles.expandBtn, { borderTopColor: cardColors.divider }]}
        activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={expanded ? "收起评估详情" : "查看评估详情"}
        onPress={() => setExpanded((value) => !value)}>
        <Text style={[styles.expandLabel, { color: cardColors.muted }]}>{expanded ? "收起详情" : "查看详情"}</Text>
        <Text style={[styles.expandChevron, { color: cardColors.muted }]}>{expanded ? "⌃" : "⌄"}</Text>
      </TouchableOpacity> : null}
      {expanded ? <View style={styles.analysis}>
        {data.narrative || data.summary ? <Text selectable style={[styles.narrative, { color: cardColors.text }]}>
          {data.narrative || data.summary}
        </Text> : null}
        {data.drifts?.map((item, index) => <Text selectable key={`${index}-${item}`} style={[styles.analysisItem, { color: cardColors.muted }]}>
          偏离 · {item}
        </Text>)}
        {data.verification ? <View style={styles.verification}>
          <Text selectable style={[styles.verificationSummary, { color: cardColors.text }]}>{data.verification.summary}</Text>
          {data.verification.evidence.map((fact, index) => <Text selectable key={`${index}-${fact}`} style={[styles.analysisItem, { color: cardColors.muted }]}>· {fact}</Text>)}
        </View> : null}
        {data.detail ? <>
          <TouchableOpacity accessibilityRole="button" onPress={() => setShowPrompt((value) => !value)} style={styles.promptToggle}>
            <Text style={[styles.promptToggleText, { color: cardColors.muted }]}>{showPrompt ? "收起审核提示词" : "查看审核提示词"}</Text>
          </TouchableOpacity>
          {showPrompt ? <Text selectable style={[styles.detailText, { color: cardColors.muted }]}>{data.detail}</Text> : null}
        </> : null}
      </View> : null}
    </View>
    {diffFiles.length ? (
      <View style={styles.diffBox}>
        <View style={styles.diffSummary}>
          <Text style={styles.diffHeading}>文件变更 · {diffFiles.length} 个</Text>
          {data.diffIncomplete ? <Text style={styles.diffCaveat}>可能不全</Text> : null}
          <Text style={styles.added}>+{totalAdded}</Text>
          <Text style={styles.removed}>-{totalRemoved}</Text>
        </View>
        <FileTree files={diffFiles} />
      </View>
    ) : data.diffIncomplete ? (
      <Text style={styles.missingDiff}>文件变更可能未被记录</Text>
    ) : null}
    {commitCwd || visibleFollowups.length || commitProgress ? (
      <View style={styles.followups}>
        <Text style={styles.followupsHeading}>接下来可以问</Text>
        {commitCwd && !commitProgress ? (
          <TouchableOpacity activeOpacity={0.75} disabled={commitRunning} onPress={startCommit} accessibilityRole="button" accessibilityLabel="预览 Pi 提交" style={[styles.followupBubble, styles.commitBubble]}>
            <Text style={styles.commitText}>{commitRunning ? "正在启动 Pi…" : "预览 Pi 提交"}</Text>
            <Text style={styles.commitArrow}>↗</Text>
          </TouchableOpacity>
        ) : null}
        {visibleFollowups.map((suggestion, index) => (
          <TouchableOpacity key={`${index}-${suggestion}`} activeOpacity={0.75} onPress={() => useFollowup(suggestion)} accessibilityRole="button" accessibilityLabel={`${props.layout.platform === "web" ? "填入" : "复制"}追问：${suggestion}`} style={styles.followupBubble}>
            <Text style={styles.followupText}>{suggestion}</Text>
            <Text style={styles.followupArrow}>↗</Text>
          </TouchableOpacity>
        ))}
        {commitProgress ? <View style={styles.commitProgress}>
          {commitProgress.kind === "preparing" ? <View style={styles.commitSteps}>
            {commitSteps.map((step, index) => <Text key={step} style={[styles.commitStep, index === commitStep(commitProgress.stage) && styles.commitStepActive, index < commitStep(commitProgress.stage) && styles.commitStepDone]}>{index + 1}. {step}</Text>)}
          </View> : null}
          <Text style={[styles.followupFeedback, commitProgress.kind === "failed" && styles.commitError]}>
            {commitProgress.kind === "preparing" ? `准备中 · ${commitProgress.stage} · 已等待 ${Math.floor((Date.now() - commitProgress.startedAt) / 1000)} 秒` : commitProgress.stage}
          </Text>
          {commitProgress.kind === "failed" && (commitCwd || commitTargetCwd) ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="重试 Pi 提交预览" onPress={startCommit} style={styles.retryButton}><Text style={styles.retryText}>重试</Text></TouchableOpacity> : null}
        </View> : null}
        {pendingDiffFiles.length && commitProgress?.kind !== "ready" ? <View style={styles.pendingDiffBox}>
          <Text style={styles.pendingDiffHeading}>当前待提交 diff · {pendingDiffFiles.length} 个候选文件</Text>
          <FileTree files={pendingDiffFiles} />
        </View> : null}
        {followupFeedback ? <Text style={styles.followupFeedback}>{followupFeedback}</Text> : null}
      </View>
    ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  reviewGroup: { marginVertical: 4, gap: 8 },
  container: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
    gap: 12,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    fontSize: 12,
    fontWeight: "700",
    overflow: "hidden",
    borderRadius: 6,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  time: {
    fontSize: 11,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    paddingBottom: 2,
  },
  stat: {
    fontSize: 12,
    fontWeight: "600",
  },
  narrative: {
    fontSize: 13,
    lineHeight: 20,
  },
  expandBtn: {
    marginTop: 2,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  expandLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  expandChevron: { fontSize: 18, lineHeight: 18 },
  goal: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
  },
  analysis: { gap: 10, paddingBottom: 12 },
  analysisItem: { fontSize: 12, lineHeight: 18 },
  verification: { gap: 5 },
  verificationSummary: { fontSize: 12, fontWeight: "600", lineHeight: 18 },
  promptToggle: { alignSelf: "flex-start", paddingVertical: 5 },
  promptToggleText: { fontSize: 12, fontWeight: "600" },
  diffBox: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#d8dee6", borderRadius: 8, overflow: "hidden" },
  diffSummary: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e5e7eb" },
  diffHeading: { color: "#111827", fontSize: 12, fontWeight: "700", flex: 1 },
  diffCaveat: { color: "#92400e", fontSize: 10 },
  missingDiff: { color: "#6b7280", fontSize: 11, paddingHorizontal: 2 },
  added: { color: "#15803d", fontSize: 12, fontWeight: "600" },
  removed: { color: "#b91c1c", fontSize: 12, fontWeight: "600" },
  detailText: {
    fontSize: 11,
    lineHeight: 17,
    fontFamily: "monospace",
  },
  followups: { alignItems: "flex-start", gap: 7, paddingHorizontal: 2 },
  followupsHeading: { color: "#6b7280", fontSize: 12, fontWeight: "600", marginBottom: 1 },
  followupBubble: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 10, maxWidth: "90%", minHeight: 38, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 10, backgroundColor: "#fff", borderWidth: StyleSheet.hairlineWidth, borderColor: "#d8dee6" },
  commitBubble: { backgroundColor: "#eef2ff", borderColor: "#c7d2fe" },
  commitText: { color: "#3730a3", fontSize: 13, lineHeight: 19, fontWeight: "600" },
  commitArrow: { color: "#6366f1", fontSize: 14, lineHeight: 19 },
  followupText: { color: "#1f2937", fontSize: 13, lineHeight: 19, fontWeight: "500", flexShrink: 1 },
  followupArrow: { color: "#9ca3af", fontSize: 14, lineHeight: 19 },
  followupFeedback: { color: "#6b7280", fontSize: 11 },
  commitError: { color: "#b91c1c" },
  commitProgress: { gap: 6 },
  commitSteps: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  commitStep: { color: "#9ca3af", fontSize: 11 },
  commitStepActive: { color: "#3730a3", fontWeight: "700" },
  commitStepDone: { color: "#6b7280" },
  retryButton: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: "#eef2ff" },
  retryText: { color: "#3730a3", fontSize: 12, fontWeight: "600" },
  pendingDiffBox: { alignSelf: "stretch", borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: "#d8dee6", backgroundColor: "#fff", paddingVertical: 6 },
  pendingDiffHeading: { color: "#374151", fontSize: 12, fontWeight: "600", paddingHorizontal: 12, paddingVertical: 5 },
});
