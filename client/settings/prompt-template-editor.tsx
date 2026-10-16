import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, TextInput, View, useColorScheme } from "react-native";
import { composePromptTemplate, promptEditableParts, promptFixedSegments, type PromptKind } from "../../shared/prompts";

const variablePattern = /(\{\{[A-Za-z][A-Za-z0-9]*\}\})/g;

function isNodeInFixed(root: HTMLElement | null, node: Node): boolean {
  let current: Node | null = node;
  while (current && current !== root) {
    if (current instanceof HTMLElement && current.dataset.fixedIndex !== undefined) return true;
    current = current.parentNode;
  }
  return false;
}

function insertPlainText(value: string) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(value);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function WebPromptEditor({ label, segments, draft, onChange, resetVersion, dark, text, muted, accent }: {
  label: string; segments: readonly string[]; draft: string[]; onChange(value: string[]): void;
  resetVersion: number; dark: boolean; text: string; muted: string; accent: string;
}) {
  const editor = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const latestDraft = useRef(draft);
  const latestReset = useRef(resetVersion);
  latestDraft.current = draft;

  const render = (parts: readonly string[]) => {
    const root = editor.current;
    if (!root) return;
    const nodes: Node[] = [];
    const editableNodes = (value: string): Node[] => {
      const result: Node[] = [];
      value.split("\n").forEach((line, lineIndex) => {
        if (lineIndex) result.push(document.createTextNode("\n"));
        const match = line.match(/^(goal|drifts|narrative|result|task_type|followups)(：|:)/);
        if (match) {
          const field = document.createElement("span");
          field.style.fontWeight = "600";
          field.style.color = dark ? "#cbd5e1" : "#475569";
          field.textContent = match[0];
          result.push(field, document.createTextNode(line.slice(match[0].length)));
        } else result.push(document.createTextNode(line));
      });
      return result;
    };
    segments.forEach((segment, index) => {
      nodes.push(...editableNodes(parts[index] ?? ""));
      const fixed = document.createElement("span");
      fixed.dataset.fixedIndex = String(index);
      fixed.contentEditable = "false";
      fixed.setAttribute("aria-label", `${label}固定内容 ${index + 1}`);
      fixed.style.color = muted;
      fixed.style.whiteSpace = "pre-wrap";
      for (const piece of segment.split(variablePattern)) {
        if (piece.startsWith("{{")) {
          const variable = document.createElement("span");
          variable.style.color = accent;
          variable.style.fontWeight = "600";
          variable.style.textDecoration = "underline";
          variable.style.textDecorationColor = dark ? "#6366a8" : "#c7c4ee";
          variable.style.textUnderlineOffset = "3px";
          variable.textContent = piece;
          fixed.append(variable);
        } else fixed.append(document.createTextNode(piece));
      }
      nodes.push(fixed);
    });
    nodes.push(...editableNodes(parts[segments.length] ?? ""));
    root.replaceChildren(...nodes);
  };

  useLayoutEffect(() => {
    if (latestReset.current !== resetVersion || !editor.current?.childNodes.length) {
      render(draft);
      latestReset.current = resetVersion;
    }
  });

  const read = (): string[] => {
    const root = editor.current;
    if (!root) return draft.map(() => "");
    const fixed = Array.from(root.querySelectorAll<HTMLElement>("[data-fixed-index]"));
    if (fixed.length !== segments.length) return [...draft];
    const parts: string[] = [];
    for (let index = 0; index <= fixed.length; index++) {
      const range = document.createRange();
      if (index === 0) range.setStart(root, 0);
      else range.setStartAfter(fixed[index - 1]);
      if (index === fixed.length) range.setEnd(root, root.childNodes.length);
      else range.setEndBefore(fixed[index]);
      parts.push(range.toString());
    }
    return parts;
  };

  return <>
  <div ref={editor} role="textbox" aria-label={`${label}提示词模板编辑器`} aria-multiline="true"
    contentEditable suppressContentEditableWarning spellCheck={false}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    onBeforeInput={(event) => {
      const selection = window.getSelection();
      if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (isNodeInFixed(editor.current, range.startContainer) || isNodeInFixed(editor.current, range.endContainer)) event.preventDefault();
    }}
    onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); insertPlainText("\n"); const next = read(); onChange(next); setReadFailed(next.length !== segments.length + 1); } }}
    onPaste={(event) => { event.preventDefault(); insertPlainText(event.clipboardData.getData("text/plain")); const next = read(); onChange(next); setReadFailed(next.length !== segments.length + 1); }}
    onInput={() => {
      const next = read();
      onChange(next);
      setReadFailed(next.length !== segments.length + 1);
    }}
    style={{ border: `1px solid ${focused ? accent : dark ? "#435066" : "#d8dee8"}`, borderRadius: 10,
      background: dark ? "#111827" : "#fff", padding: "24px 28px", color: text,
      minHeight: 340,
      fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: 14, lineHeight: "24px", whiteSpace: "pre-wrap", overflowWrap: "anywhere",
      outline: "none", boxShadow: focused ? `0 0 0 3px ${dark ? "#363666" : "#eceaff"}` : "0 1px 2px rgba(15,23,42,.04)",
      caretColor: accent, transition: "border-color 150ms ease, box-shadow 150ms ease" }} />
    {readFailed ? <div style={{ marginTop: 4, fontSize: 12, color: muted }}>输入已暂存，请检查编辑内容后再保存</div> : null}
  </>;
}

function NativeEditableSlot({ label, value, onChange, text, muted }: {
  label: string; value: string; onChange(value: string): void; text: string; muted: string;
}) {
  const [contentHeight, setContentHeight] = useState(0);
  return <TextInput accessibilityLabel={label} multiline scrollEnabled={false} value={value}
    placeholder={value ? undefined : "在这里输入…"} placeholderTextColor={muted}
    onChangeText={onChange}
    onContentSizeChange={(event) => {
      const measured = Math.ceil(event.nativeEvent.contentSize.height) + 14;
      setContentHeight((current) => Math.abs(current - measured) > 2 ? measured : current);
    }}
    style={{ width: value.trim() ? "100%" : 72, minHeight: 34, height: Math.max(34, contentHeight),
      paddingHorizontal: 3, paddingVertical: 5, color: text, fontSize: 14, lineHeight: 23,
      textAlignVertical: "top" }} />;
}

export function PromptTemplateEditor({ label, kind, value, draft, onChange, defaultValue, onSave }: {
  label: string;
  kind: PromptKind;
  value: string;
  draft: string[];
  onChange(value: string[]): void;
  defaultValue: string;
  onSave(value: string): Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [resetVersion, setResetVersion] = useState(0);
  const dark = useColorScheme() === "dark";
  const text = dark ? "#f1f5f9" : "#172033";
  const muted = dark ? "#94a3b8" : "#64748b";
  const accent = dark ? "#a5b4fc" : "#4338ca";
  const segments = promptFixedSegments(kind);
  const saved = promptEditableParts(kind, value) ?? [];
  const dirty = draft.some((part, index) => part !== saved[index]);
  const canSave = dirty && !busy;

  return <View style={{ gap: 12 }}>
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
      <Text style={{ color: text, fontSize: 13, fontWeight: "600" }}>模板内容</Text>
      <Text style={{ color: muted, fontSize: 12 }}>紫色变量与灰色内容已锁定</Text>
    </View>
    {Platform.OS === "web" ? <WebPromptEditor label={label} segments={segments} draft={draft} onChange={onChange}
      resetVersion={resetVersion} dark={dark} text={text} muted={muted} accent={accent} />
      : <View accessibilityLabel={`${label}提示词模板编辑器`} style={{ borderWidth: 1, borderColor: dark ? "#475569" : "#cbd5e1", borderRadius: 10,
      backgroundColor: dark ? "#141c2a" : "#fff", padding: 16, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
      {draft.map((part, index) => {
        return <Fragment key={index}>
          <NativeEditableSlot label={`${label}可编辑区域 ${index + 1}`} value={part} text={text} muted={muted}
            onChange={(nextPart) => onChange(draft.map((current, slot) => slot === index ? nextPart : current))}
            />
          {index < segments.length ? <View accessibilityLabel={`${label}固定内容 ${index + 1}`}
            style={{ alignSelf: "flex-start", width: segments[index].includes("\n") || segments[index].length > 80 ? "100%" : undefined,
              maxWidth: "100%" }}>
            <Text selectable style={{ color: muted, fontSize: 13, lineHeight: 21 }}>
              {segments[index].split(variablePattern).map((piece, pieceIndex) => piece.startsWith("{{")
                ? <Text key={pieceIndex} style={{ color: accent, fontWeight: "700" }}>{piece}</Text>
                : piece)}
            </Text>
          </View> : null}
        </Fragment>;
      })}
    </View>}
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 10, paddingTop: 2 }}>
      {dirty ? <Text style={{ color: muted, fontSize: 12, marginRight: "auto" }}>尚未保存</Text> : null}
      <Pressable accessibilityRole="button" onPress={() => { onChange(promptEditableParts(kind, defaultValue) ?? []); setResetVersion((current) => current + 1); }}
        style={{ minHeight: 40, justifyContent: "center", paddingHorizontal: 12 }}>
        <Text style={{ color: accent, fontWeight: "500", fontSize: 13 }}>恢复默认</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={!canSave} onPress={() => { setBusy(true); void onSave(composePromptTemplate(kind, draft)).finally(() => setBusy(false)); }}
        style={{ minHeight: 40, justifyContent: "center", paddingHorizontal: 18, borderRadius: 7, backgroundColor: canSave ? "#4f46e5" : dark ? "#334155" : "#e6e9ef" }}>
        <Text style={{ color: canSave ? "#fff" : muted, fontWeight: "600", fontSize: 13 }}>{busy ? "保存中…" : "保存模板"}</Text>
      </Pressable>
    </View>
  </View>;
}
