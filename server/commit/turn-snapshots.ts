import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWriteJson } from "./atomic-write.ts";
import { disposeSnapshot, type WorktreeSnapshot } from "./snapshot.ts";

type SavedTurnSnapshot = { turnId: string | null; snapshot: WorktreeSnapshot };

function recordPath(agentId: string): string {
  const id = createHash("sha256").update(agentId).digest("hex");
  return join(tmpdir(), `vibe-review-turn-${id}.json`);
}

/** Keep the baseline across plugin subprocess reloads. */
export async function takeTurnSnapshot(agentId: string): Promise<SavedTurnSnapshot | undefined> {
  const path = recordPath(agentId);
  let saved: SavedTurnSnapshot;
  try {
    saved = JSON.parse(await readFile(path, "utf8")) as SavedTurnSnapshot;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  await rm(path, { force: true });
  return saved;
}

export async function saveTurnSnapshot(agentId: string, saved: SavedTurnSnapshot): Promise<void> {
  await atomicWriteJson(recordPath(agentId), saved);
}

export async function replaceTurnSnapshot(agentId: string, saved: SavedTurnSnapshot): Promise<void> {
  const previous = await takeTurnSnapshot(agentId);
  if (previous) await disposeSnapshot(previous.snapshot);
  try {
    await saveTurnSnapshot(agentId, saved);
  } catch (error) {
    await disposeSnapshot(saved.snapshot);
    throw error;
  }
}
