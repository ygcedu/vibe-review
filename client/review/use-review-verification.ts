import { useEffect, useRef, useState } from "react";
import { Linking, Platform } from "react-native";
import { buildAgentDeepLink } from "@getpaseo/protocol/agent-deep-link";
import { useRpc } from "@getpaseo/plugin/client";
import { cancelVerificationRpc, reconcileVerificationRpc, openVerificationRpc } from "../../shared/review";

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

export function useReviewVerification(agentId: string, serverId: string, scoredAt: string, verificationRunning: boolean, verifierAgentId?: string) {
  const [cancelingVerification, setCancelingVerification] = useState(false);
  const [verificationError, setVerificationError] = useState("");
  const [openingVerifier, setOpeningVerifier] = useState(false);
  const prepareOpenVerification = useRpc(openVerificationRpc);
  const showVerifier = async () => {
    if (!verifierAgentId || openingVerifier) return;
    setOpeningVerifier(true);
    setVerificationError("");
    try {
      const target = await prepareOpenVerification({ agentId, scoredAt });
      openVerifier(serverId, target.verifierAgentId, target.workspaceId);
    } catch (error) {
      setVerificationError(error instanceof Error ? error.message : "无法打开验证 agent");
    } finally {
      setOpeningVerifier(false);
    }
  };
  const cancelVerification = useRpc(cancelVerificationRpc);
  const reconcileVerification = useRpc(reconcileVerificationRpc);
  const reconcileVerificationRef = useRef(reconcileVerification);
  reconcileVerificationRef.current = reconcileVerification;
  useEffect(() => {
    if (!verificationRunning) return;
    const refresh = () => { void reconcileVerificationRef.current({ agentId, scoredAt }).catch(() => {}); };
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => clearInterval(timer);
  }, [agentId, scoredAt, verificationRunning]);
  const stopVerification = () => {
    if (cancelingVerification || !verificationRunning) return;
    setCancelingVerification(true);
    setVerificationError("");
    void (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await cancelVerification({ agentId, scoredAt });
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

  return { cancelingVerification, verificationError, openingVerifier, showVerifier, stopVerification };
}
