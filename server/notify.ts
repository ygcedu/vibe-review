import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** ponytail: osascript for macOS notifications; upgrade path: terminal-notifier for rich payloads. */
export function notify(title: string, message: string): Promise<void> {
  const script = `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`;
  return execFileAsync("osascript", ["-e", script])
    .then((): undefined => undefined)
    .catch((error: unknown) => {
      console.error("[vibe-review] notification failed:", error);
    });
}
