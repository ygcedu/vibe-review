import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * ponytail: hand-rolled AppleScript string-literal escaping (backslash then quote)
 * keeps titles/messages free of literal newlines; upgrade path: osascript -n
 * reading the payload from JSON in argv, or terminal-notifier.
 */
export function appleScriptString(value: string): string {
  const text = String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]/g, " ");
  return `"${text}"`;
}

/** ponytail: osascript for macOS notifications; upgrade path: terminal-notifier for rich payloads. */
export function notify(title: string, message: string): Promise<void> {
  const script = `display notification ${appleScriptString(message)} with title ${appleScriptString(title)}`;
  return execFileAsync("osascript", ["-e", script])
    .then((): undefined => undefined)
    .catch((error: unknown) => {
      console.error("[vibe-review] notification failed:", error);
    });
}
