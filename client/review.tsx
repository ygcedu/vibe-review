import type { ComponentType } from "react";
import { isNoDrift } from "../shared/drift";
import { Linking, Platform, View, Text, StyleSheet, TouchableOpacity, useColorScheme } from "react-native";
import { buildAgentDeepLink } from "@getpaseo/protocol/agent-deep-link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePaseo, useRpc, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { output } from "zod";
import { cancelVerificationRpc, reconcileVerificationRpc, openVerificationRpc, reviewResultSchema } from "../shared/review";
import { parseDiffFiles } from "./diff";
import { FileTree } from "./file-tree";
import { copyText } from "@getpaseo/plugin/client/react-native";
import { fillVisibleComposer } from "./composer-fill";
import { commitAvailabilityRpc, preparePiCommitRpc, piCommitStatusRpc, getPendingCommitDiffRpc, COMMIT_PREVIEW_KIND, COMMIT_RESULT_KIND } from "../shared/commit";

type ReviewResultData = output<typeof reviewResultSchema>;

const verdictStyle = {
  pass: { accent: "#15803d", darkAccent: "#86efac", tint: "#dcfce7", darkTint: "#153d29", label: "通过" },
  review: { accent: "#b45309", darkAccent: "#fcd34d", tint: "#fef3c7", darkTint: "#493018", label: "待复核" },
  reject: { accent: "#b91c1c", darkAccent: "#fca5a5", tint: "#fee2e2", darkTint: "#491f20", label: "未通过" },
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

const verificationLabel = { passed: "通过", failed: "未通过", unavailable: "未能完成" } as const;

function openVerifier(serverId: string, agentId: string, workspaceId: string): void {
  const target = { serverId, agentId };
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const route = `/h/${encodeURIComponent(serverId)}/workspace/${encodeURIComponent(workspaceId)}?open=${encodeURIComponent(`agent:${agentId}`)}`;
    window.history.pushState({}, "", route);
    window.dispatchEvent(new PopStateEvent("popstate"));
  } else {
    void Linking.openURL(buildAgentDeepLink(target));
  }
}

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
  const verificationRunning = data.verificationState === "running";
  const legacyNoDrift = data.result === "done" && data.verification?.status === "passed" && !!data.drifts?.length && data.drifts.every(isNoDrift);
  const displayVerdict = data.verificationState === "canceled" && data.verdict === "pass" ? "review" : legacyNoDrift ? "pass" : data.verdict;
  const v = verdictStyle[displayVerdict];
  const dark = useColorScheme() === "dark";
  const accent = dark ? v.darkAccent : v.accent;
  const cardColors = dark
    ? { background: "#1f2937", border: "#374151", text: "#f3f4f6", muted: "#a9b3c2", divider: "#374151" }
    : { background: "#ffffff", border: "#d8dee6", text: "#111827", muted: "#6b7280", divider: "#e5e7eb" };
  const [openPanel, setOpenPanel] = useState<"details" | "files" | "suggestions" | null>("suggestions");
  const expanded = openPanel === "details";
  const showFiles = openPanel === "files";
  const showSuggestions = openPanel === "suggestions";
  const togglePanel = (panel: "details" | "files" | "suggestions") => setOpenPanel((current) => current === panel ? null : panel);
  const [showPrompt, setShowPrompt] = useState(false);
  const [followupFeedback, setFollowupFeedback] = useState("");
  const [cancelingVerification, setCancelingVerification] = useState(false);
  const [verificationError, setVerificationError] = useState("");
  const [openingVerifier, setOpeningVerifier] = useState(false);
  const [commitCwd, setCommitCwd] = useState<string | null>(null);
  const [commitUnavailableReason, setCommitUnavailableReason] = useState<"no_changes" | null>(null);
  const [commitTargetCwd, setCommitTargetCwd] = useState<string | null>(null);
  const [commitRunning, setCommitRunning] = useState(false);
  const [commitProgress, setCommitProgress] = useState<{ kind: "preparing" | "ready" | "failed"; stage: string; startedAt: number } | null>(null);
  const [pendingDiff, setPendingDiff] = useState<string | null>(null);
  const superseded = useRef(false);
  const paseo = usePaseo();
  const prepareOpenVerification = useRpc(openVerificationRpc);
  const showVerifier = async () => {
    if (!data.verificationAgentId || openingVerifier) return;
    setOpeningVerifier(true);
    setVerificationError("");
    try {
      const target = await prepareOpenVerification({ agentId: props.agentId, scoredAt: data.scoredAt });
      openVerifier(props.host.id, target.verifierAgentId, target.workspaceId);
    } catch (error) {
      setVerificationError(error instanceof Error ? error.message : "无法打开验证 agent");
    } finally {
      setOpeningVerifier(false);
    }
  };
  const pendingDiffRequested = useRef(false);
  const checkCommit = useRpc(commitAvailabilityRpc);
  const cancelVerification = useRpc(cancelVerificationRpc);
  const reconcileVerification = useRpc(reconcileVerificationRpc);
  const reconcileVerificationRef = useRef(reconcileVerification);
  reconcileVerificationRef.current = reconcileVerification;
  useEffect(() => {
    if (data.verificationState !== "running") return;
    const refresh = () => { void reconcileVerificationRef.current({ agentId: props.agentId, scoredAt: data.scoredAt }).catch(() => {}); };
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => clearInterval(timer);
  }, [props.agentId, data.scoredAt, data.verificationState]);
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
        (result) => { if (active) { setCommitCwd(!superseded.current && result.available ? result.cwd ?? null : null); setCommitUnavailableReason(!superseded.current ? result.reason ?? null : null); } },
        () => { if (active) { setCommitCwd(null); setCommitUnavailableReason(null); } },
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
        setCommitUnavailableReason(null);
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
        if (status.kind === "ready" || status.kind === "finished") {
          // The timeline preview card is now the source of truth. It may be
          // rendered on another device before this polling request resolves.
          setCommitProgress(null);
          setPendingDiff(null);
        } else if (status.kind === "idle") {
          void paseo.agents.ref(props.agentId).timeline.refetch({ limit: 50 }).then((timeline) => {
            if (!active) return;
            const items = timeline.entries.map((entry) => entry.item);
            const reviewIndex = items.findLastIndex((item) => item.type === "plugin" && item.kind === "review-result" && typeof item.data === "object" && item.data !== null && !Array.isArray(item.data) && item.data.scoredAt === data.scoredAt);
            const completed = reviewIndex >= 0 && items.slice(reviewIndex + 1).some((item) => item.type === "plugin" &&
              (item.kind === COMMIT_PREVIEW_KIND || item.kind === COMMIT_RESULT_KIND));
            if (completed) {
              setCommitProgress(null);
              setPendingDiff(null);
            } else {
              setCommitProgress((current) => current?.kind === "preparing" && Date.now() - current.startedAt > 10_000
                ? { kind: "failed", stage: "预览任务已中断，请重试。", startedAt: current.startedAt }
                : current);
            }
          }).catch(() => { /* Keep polling while the mobile connection recovers. */ });
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
      }, () => {
        if (active) setCommitProgress((current) => current?.kind === "preparing"
          ? { ...current, stage: "连接暂时中断，正在重新同步…" } : current);
      });
    };
    refresh();
    const timer = setInterval(refresh, 2_000);
    return () => { active = false; clearInterval(timer); };
  }, [paseo, props.agentId, data.scoredAt, commitRunning, commitProgress?.kind]);
  const diffFiles = useMemo(() => parseDiffFiles(data.diff), [data.diff]);
  const totalAdded = diffFiles.reduce((total, file) => total + file.added, 0);
  const totalRemoved = diffFiles.reduce((total, file) => total + file.removed, 0);
  const followups = verificationRunning ? [] : data.followups ?? [];
  const otherFollowups = commitCwd ? followups.filter((suggestion) => !/提交|commit/i.test(suggestion)) : followups;
  const visibleFollowups = (otherFollowups.length ? otherFollowups : followups).slice(0, commitCwd ? 2 : 3);
  const pendingDiffFiles = useMemo(() => pendingDiff ? parseDiffFiles(pendingDiff) : [], [pendingDiff]);
  const hasAnalysis = Boolean(data.narrative || data.summary || data.drifts?.length || data.verification || data.detail);

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

  const stopVerification = () => {
    if (cancelingVerification || !verificationRunning) return;
    setCancelingVerification(true);
    setVerificationError("");
    void (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await cancelVerification({ agentId: props.agentId, scoredAt: data.scoredAt });
          return;
        } catch (error) {
          if (/验证已结束/.test(String(error))) return;
          if (!/Transport (?:closed|not connected)|status: disconnected/i.test(String(error)) || attempt === 2) {
            setVerificationError("取消请求未能送达，请稍后重试。");
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
    })().finally(() => setCancelingVerification(false));
  };

  return (
    <View style={[styles.reviewGroup, { backgroundColor: cardColors.background, borderColor: cardColors.border }]}>
    <View style={[styles.container, { borderBottomColor: cardColors.divider }]}>
      <View style={styles.header}>
        <View style={styles.headerIdentity}>
          <Text style={[styles.pluginLabel, { color: cardColors.muted }]}>VIBE REVIEW 插件 · 轮次评估</Text>
          <Text style={[styles.title, { color: verificationRunning ? (dark ? "#93c5fd" : "#1d4ed8") : accent, backgroundColor: verificationRunning ? (dark ? "#1e3a5f" : "#dbeafe") : dark ? v.darkTint : v.tint }]}>
            {data.processing ? "评估中" : verificationRunning ? "验证中" : v.label}
          </Text>
        </View>
        <View style={styles.headerRight}>
          {verificationRunning ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="取消独立验证" disabled={cancelingVerification} onPress={stopVerification} style={[styles.cancelVerification, { borderColor: cardColors.border }]}>
            <Text style={[styles.cancelVerificationText, { color: cardColors.muted }]}>{cancelingVerification ? "取消中…" : "取消验证"}</Text>
          </TouchableOpacity> : null}
          <Text style={[styles.time, { color: cardColors.muted }]}>{formatTime(data.scoredAt)}</Text>
        </View>
      </View>
      {data.goal ? (
        <Text style={[styles.goal, { color: cardColors.text }]}>
          {data.goal}
        </Text>
      ) : null}
      {data.processing ? <Text style={[styles.summary, { color: cardColors.muted }]}>正在生成结论…</Text> : data.verification?.summary && !expanded ? <Text numberOfLines={2} style={[styles.summary, { color: cardColors.muted }]}>验证：{data.verification.summary}</Text> : null}
      {verificationRunning ? <View style={styles.verificationActions}>
        <Text style={[styles.verificationPending, { color: cardColors.muted }]}>{data.verificationStage || "正在启动独立验证…"}</Text>
      </View> : null}
      {verificationError ? <Text selectable style={styles.verificationError}>{verificationError}</Text> : null}
      <View style={styles.metaActions}>
      {diffFiles.length ? <TouchableOpacity style={[styles.metaButton, showFiles && styles.metaButtonActive, showFiles && { backgroundColor: dark ? "#293747" : "#eef2ff", borderColor: dark ? "#64748b" : "#a5b4fc" }]} activeOpacity={0.7} accessibilityRole="button" accessibilityState={{ selected: showFiles }} accessibilityLabel={`${showFiles ? "收起" : "展开"}文件变更，${diffFiles.length} 个文件，增加 ${totalAdded} 行，删除 ${totalRemoved} 行`} onPress={() => togglePanel("files")}>
        <Text style={[styles.metaText, { color: showFiles ? (dark ? "#c7d2fe" : "#3730a3") : cardColors.muted }]}>文件变更 · {diffFiles.length} 个</Text>
        <Text style={styles.added}>+{totalAdded}</Text>
        <Text style={styles.removed}>-{totalRemoved}</Text>
        {data.diffIncomplete ? <Text style={styles.diffCaveat}>可能不全</Text> : null}
      </TouchableOpacity> : null}
      {hasAnalysis ? <TouchableOpacity style={[styles.metaButton, expanded && styles.metaButtonActive, expanded && { backgroundColor: dark ? "#293747" : "#eef2ff", borderColor: dark ? "#64748b" : "#a5b4fc" }]}
        activeOpacity={0.7} accessibilityRole="button" accessibilityState={{ selected: expanded }} accessibilityLabel={expanded ? "收起评估详情" : "查看评估详情"}
        onPress={() => togglePanel("details")}>
        <Text style={[styles.metaText, { color: expanded ? (dark ? "#c7d2fe" : "#3730a3") : cardColors.muted }]}>评估/验证</Text>
      </TouchableOpacity> : null}
      {(visibleFollowups.length || commitCwd || commitProgress || commitUnavailableReason) ? <TouchableOpacity style={[styles.metaButton, showSuggestions && styles.metaButtonActive, showSuggestions && { backgroundColor: dark ? "#293747" : "#eef2ff", borderColor: dark ? "#64748b" : "#a5b4fc" }]} activeOpacity={0.7} accessibilityRole="button" accessibilityState={{ selected: showSuggestions }} accessibilityLabel={showSuggestions ? "收起后续建议" : "展开后续建议"} onPress={() => togglePanel("suggestions")}>
        <Text style={[styles.metaText, { color: showSuggestions ? (dark ? "#c7d2fe" : "#3730a3") : cardColors.muted }]}>下一步建议</Text>
      </TouchableOpacity> : null}
      </View>
      {expanded ? <View style={styles.analysis}>
        {data.narrative || data.summary || data.drifts?.length || data.detail ? <View style={[styles.detailSection, { backgroundColor: dark ? "#263241" : "#f8fafc", borderColor: cardColors.border }]}>
          <Text style={[styles.detailSectionTitle, { color: cardColors.muted }]}>任务评估</Text>
          <Text style={[styles.analysisItem, { color: cardColors.muted }]}>
            完成情况：{data.result ? resultLabel[data.result] : `${Math.round(data.completed * 100)}%`} · 目标范围：{legacyNoDrift ? driftLabel.in_scope : driftLabel[data.drift]}
          </Text>
          {data.narrative || data.summary ? <Text selectable style={[styles.narrative, { color: cardColors.text }]}>
            {data.narrative || data.summary}
          </Text> : null}
          {data.drifts?.filter((item) => !isNoDrift(item)).map((item, index) => <Text selectable key={`${index}-${item}`} style={[styles.analysisItem, { color: cardColors.muted }]}>
            偏离 · {item}
          </Text>)}
          {data.detail ? <>
          <TouchableOpacity accessibilityRole="button" onPress={() => setShowPrompt((value) => !value)} style={styles.promptToggle}>
            <Text style={[styles.promptToggleText, { color: cardColors.muted }]}>{showPrompt ? "收起审核提示词" : "查看审核提示词"}</Text>
          </TouchableOpacity>
          {showPrompt ? <Text selectable style={[styles.detailText, { color: cardColors.muted }]}>{data.detail}</Text> : null}
          </> : null}
        </View> : null}
        {data.verification ? <View style={[styles.detailSection, { backgroundColor: dark ? "#263241" : "#f8fafc", borderColor: cardColors.border }]}>
          {data.verificationAgentId ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="打开验证 agent" disabled={openingVerifier} onPress={() => { void showVerifier(); }} style={styles.detailSectionHeader}>
            <Text style={[styles.detailSectionTitle, { color: cardColors.muted }]}>{openingVerifier ? "正在打开验证 agent…" : "独立验证 ↗"}</Text>
            <Text style={[styles.detailStatus, { color: data.verification.status === "passed" ? (dark ? "#86efac" : "#15803d") : accent }]}>{verificationLabel[data.verification.status]}</Text>
          </TouchableOpacity> : <View style={styles.detailSectionHeader}>
            <Text style={[styles.detailSectionTitle, { color: cardColors.muted }]}>独立验证</Text>
            <Text style={[styles.detailStatus, { color: data.verification.status === "passed" ? (dark ? "#86efac" : "#15803d") : accent }]}>{verificationLabel[data.verification.status]}</Text>
          </View>}
          <Text selectable style={[styles.verificationSummary, { color: cardColors.text }]}>{data.verification.summary}</Text>
          {data.verification.cases?.map((item, index) => <View key={`${index}-${item.name}`} style={{ marginTop: 10 }}>
            <Text selectable style={[styles.analysisItem, { color: cardColors.text }]}>{index + 1}. {item.name} · {item.status === "passed" ? "通过" : item.status === "failed" ? "失败" : "受阻"}</Text>
            {item.steps.map((step, stepIndex) => <Text selectable key={stepIndex} style={[styles.analysisItem, { color: cardColors.muted }]}>步骤 {stepIndex + 1}：{step}</Text>)}
            <Text selectable style={[styles.analysisItem, { color: cardColors.muted }]}>预期：{item.expected}</Text>
            <Text selectable style={[styles.analysisItem, { color: cardColors.muted }]}>实际：{item.actual}</Text>
          </View>)}
          {data.verification.evidence.map((fact, index) => <Text selectable key={`${index}-${fact}`} style={[styles.analysisItem, { color: cardColors.muted }]}>· {fact}</Text>)}
        </View> : null}
        {data.verificationState === "canceled" ? <View style={[styles.detailSection, { backgroundColor: dark ? "#263241" : "#f8fafc", borderColor: cardColors.border }]}>
          <Text style={[styles.detailSectionTitle, { color: cardColors.muted }]}>独立验证 · 已取消</Text>
        </View> : null}
      </View> : null}
    </View>
    {diffFiles.length && showFiles ? (
      <View style={[styles.diffBox, { borderTopColor: cardColors.divider }]}>
        <FileTree files={diffFiles} fullDiff={data.fullDiff} />
      </View>
    ) : data.diffIncomplete ? (
      <Text style={styles.missingDiff}>文件变更可能未被记录</Text>
    ) : null}
    {showSuggestions && (commitCwd || visibleFollowups.length || commitProgress || commitUnavailableReason || followupFeedback) ? (
      <View style={[styles.followups, { borderTopColor: cardColors.divider }]}>
        {commitUnavailableReason === "no_changes" ? <Text style={styles.followupFeedback}>代码已提交，当前没有待提交改动，因此无需 Pi 提交。</Text> : null}
        {commitCwd && !commitProgress ? (
          <TouchableOpacity activeOpacity={0.75} disabled={commitRunning} onPress={startCommit} accessibilityRole="button" accessibilityLabel="预览 Pi 提交" style={[styles.followupBubble, styles.commitBubble]}>
            <Text style={styles.commitText}>{commitRunning ? "正在启动 Pi…" : "预览 Pi 提交"}</Text>
            <Text style={styles.commitArrow}>↗</Text>
          </TouchableOpacity>
        ) : null}
        {showSuggestions ? visibleFollowups.map((suggestion, index) => (
          <TouchableOpacity key={`${index}-${suggestion}`} activeOpacity={0.75} onPress={() => useFollowup(suggestion)} accessibilityRole="button" accessibilityLabel={`${props.layout.platform === "web" ? "填入" : "复制"}追问：${suggestion}`} style={styles.followupBubble}>
            <Text style={styles.followupText}>{suggestion}</Text>
            <Text style={styles.followupArrow}>↗</Text>
          </TouchableOpacity>
        )) : null}
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
  reviewGroup: { marginVertical: 6, borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  container: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    gap: 12,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerIdentity: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  pluginLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
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
  verificationActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 },
  verificationPending: { fontSize: 11, lineHeight: 17, flexShrink: 1 },
  cancelVerification: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  cancelVerificationText: { fontSize: 11, fontWeight: "600" },
  verificationError: { color: "#b91c1c", fontSize: 11 },
  narrative: {
    fontSize: 13,
    lineHeight: 20,
  },
  goal: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
  },
  summary: { fontSize: 12, lineHeight: 18 },
  metaActions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12, paddingTop: 2 },
  metaButton: { minHeight: 26, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 7, borderRadius: 6, borderWidth: 1, borderColor: "transparent" },
  metaButtonActive: { borderWidth: 1 },
  metaText: { fontSize: 11, fontWeight: "600" },
  analysis: { gap: 10, paddingBottom: 12 },
  detailSection: { gap: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 11 },
  detailSectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  detailSectionTitle: { fontSize: 11, fontWeight: "700" },
  detailStatus: { fontSize: 11, fontWeight: "700" },
  analysisItem: { fontSize: 12, lineHeight: 18 },
  verificationSummary: { fontSize: 12, fontWeight: "600", lineHeight: 18 },
  promptToggle: { alignSelf: "flex-start", paddingVertical: 5 },
  promptToggleText: { fontSize: 12, fontWeight: "600" },
  diffBox: { borderTopWidth: StyleSheet.hairlineWidth },
  diffCaveat: { color: "#92400e", fontSize: 10 },
  missingDiff: { color: "#6b7280", fontSize: 11, paddingHorizontal: 2 },
  added: { color: "#15803d", fontSize: 12, fontWeight: "600" },
  removed: { color: "#b91c1c", fontSize: 12, fontWeight: "600" },
  detailText: {
    fontSize: 11,
    lineHeight: 17,
    fontFamily: "monospace",
  },
  followups: { alignItems: "flex-start", gap: 7, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
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
