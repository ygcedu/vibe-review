/** Some OpenAI-compatible endpoints append streaming fragments after a JSON response. */
export function parseFirstJsonObject<T>(text: string): T {
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') {
        quoted = true;
      } else if (char === "{") {
        depth++;
      } else if (char === "}" && --depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)) as T; }
        catch { break; } // Explanatory text may contain braces before the JSON result.
      }
    }
  }
  throw new SyntaxError("模型响应中没有完整的 JSON 对象");
}
