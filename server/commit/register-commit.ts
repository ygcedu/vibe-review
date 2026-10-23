import type { PluginServerContext } from "@getpaseo/plugin/server";
import { preparePiCommitRpc, piCommitStatusRpc, getPendingCommitDiffRpc, confirmPiCommitRpc, getPiCommitPreviewRpc, cancelPiCommitRpc, commitAvailabilityRpc } from "../../shared/commit.ts";
import { piCommitSettings } from "../../shared/settings.ts";
import { CommitWorkflow } from "./commit-workflow.ts";

export function registerCommit(server: PluginServerContext, getCommitPrompt: () => Promise<string>) {
  const settings = server.registerSettings(piCommitSettings);
  const workflow = new CommitWorkflow(async () => {
    const state = await settings.read();
    if (state.status !== "ready") throw new Error(`Pi 配置无效: ${state.error}`);
    return { config: state.values, prompt: await getCommitPrompt() };
  });

  server.handle(preparePiCommitRpc, (input, { paseo }) => workflow.prepare(paseo, input));
  server.handle(piCommitStatusRpc, ({ agentId }) => workflow.status(agentId));
  server.handle(getPendingCommitDiffRpc, ({ agentId }) => workflow.pendingDiff(agentId));
  server.handle(getPiCommitPreviewRpc, ({ agentId, proposalId }, { paseo }) => workflow.preview(paseo, agentId, proposalId));
  server.handle(confirmPiCommitRpc, ({ agentId, proposalId, message }, { paseo }) => workflow.confirm(paseo, agentId, proposalId, message));
  server.handle(cancelPiCommitRpc, ({ agentId, proposalId }, { paseo }) => workflow.cancel(paseo, agentId, proposalId));
  server.handle(commitAvailabilityRpc, ({ agentId, scoredAt }, { paseo }) => workflow.availability(paseo, agentId, scoredAt));

  return (agentId: string) => workflow.resetForTurn(agentId);
}
