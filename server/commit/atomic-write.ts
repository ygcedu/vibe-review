import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";

/**
 * Atomic write: write to a temp file then rename over the target so readers
 * never observe a partially written file. Temp file is always cleaned up.
 */
export async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
