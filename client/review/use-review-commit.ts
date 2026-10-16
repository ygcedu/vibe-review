import { useEffect, useRef, useState } from "react";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { pluginData } from "../../shared/timeline";
import { REVIEW_KIND } from "../../shared/review";
import { commitAvailabilityRpc, preparePiCommitRpc, piCommitStatusRpc, getPendingCommitDiffRpc, COMMIT_PREVIEW_KIND, COMMIT_RESULT_KIND } from "../../shared/commit";

/** Commit availability and preparation belong to one review turn. */
export function useReviewCommit(agentId: string, scoredAt: string, isVisible: boolean) {
  const paseo = usePaseo();
  const pendingDiffRequested = useRef(false);
  const [commitCwd, setCommitCwd] = useState<string | null>(null);
  const [commitUnavailableReason, setCommitUnavailableReason] = useState<"no_changes" | null>(null);
  const [commitTargetCwd, setCommitTargetCwd] = useState<string | null>(null);
  const [commitRunning, setCommitRunning] = useState(false);
  const [commitProgress, setCommitProgress] = useState<{ kind: "preparing" | "ready" | "failed"; stage: string; startedAt: number } | null>(null);
  const [pendingDiff, setPendingDiff] = useState<string | null>(null);
  const superseded = useRef(false);
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
      void checkCommitRef.current({ agentId, scoredAt }).then(
        (result) => {
          if (!active) return;
          setCommitCwd(!superseded.current && result.available ? result.cwd ?? null : null);
          setCommitUnavailableReason(!superseded.current ? result.reason ?? null : null);
        },
        () => {
          if (!active) return;
          setCommitCwd(null);
          setCommitUnavailableReason(null);
        },
      );
    };
    if (isVisible) refresh();
    if (!isVisible) return () => { active = false; };
    const timer = setInterval(refresh, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, [agentId, scoredAt, isVisible]);
  useEffect(() => {
    if (!commitCwd) return;
    const subscription = paseo.agents.ref(agentId).timeline.subscribe(({ event }: { event: { type: string; item?: { type: string } } }) => {
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
  }, [paseo, agentId, Boolean(commitCwd)]);
  useEffect(() => {
    // The start RPC installs server status before it resolves. Polling earlier
    // can observe idle and falsely report an interrupted preview.
    if (commitRunning || commitProgress?.kind !== "preparing") return;
    let active = true;
    const refresh = () => {
      void getCommitStatusRef.current({ agentId }).then((status) => {
        if (!active) return;
        if (status.kind === "ready" || status.kind === "finished") {
          // The timeline preview card is now the source of truth. It may be
          // rendered on another device before this polling request resolves.
          setCommitProgress(null);
          setPendingDiff(null);
        } else if (status.kind === "idle") {
          void paseo.agents.ref(agentId).timeline.refetch({ limit: 50 }).then((timeline) => {
            if (!active) return;
            const items = timeline.entries.map((entry) => entry.item);
            const reviewIndex = items.findLastIndex((item) => pluginData(item, REVIEW_KIND)?.scoredAt === scoredAt);
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
            void getPendingDiffRef.current({ agentId }).then(
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
  }, [paseo, agentId, scoredAt, commitRunning, commitProgress?.kind]);
  const startCommit = () => {
    const cwd = commitCwd ?? commitTargetCwd;
    if (!cwd || superseded.current || commitRunning || commitProgress?.kind === "preparing") return;
    setCommitTargetCwd(cwd);
    setPendingDiff(null);
    pendingDiffRequested.current = false;
    setCommitRunning(true);
    setCommitProgress({ kind: "preparing", stage: "正在启动 Pi…", startedAt: Date.now() });
    void preparePiCommit({ agentId, cwd, scoredAt }).then(
      () => setCommitCwd(null),
      (error: unknown) => setCommitProgress({ kind: "failed", stage: `无法启动 Pi：${error instanceof Error ? error.message : String(error)}`, startedAt: Date.now() }),
    ).finally(() => setCommitRunning(false));
  };

  return { commitCwd, commitUnavailableReason, commitTargetCwd, commitRunning, commitProgress, pendingDiff, startCommit };
}
