import type { PluginClientContext } from "@getpaseo/plugin/client";
import { clarifyRpc } from "../../shared/clarify";

type Selection = { input: HTMLTextAreaElement; fullText: string; start: number; end: number; text: string };

/** HACK(Paseo 0.11): the plugin API has no composer selection or draft replacement capability.
 * This web-only adapter can be removed when Paseo exposes both to composer pills. */
export function createClarifyController(client: PluginClientContext) {
  if (typeof document === "undefined") return { open: (_agentId: string) => {}, dispose: () => {} };
  let selection: Selection | null = null;
  let card: HTMLDivElement | null = null;
  let requestId = 0;

  const isComposer = (input: Element | null): input is HTMLTextAreaElement =>
    input instanceof HTMLTextAreaElement && input.hasAttribute("data-composer-input");
  const visible = (input: HTMLTextAreaElement) => {
    const box = input.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };
  const capture = () => {
    const input = document.activeElement;
    if (!isComposer(input) || !visible(input)) return;
    const { selectionStart: start, selectionEnd: end, value: fullText } = input;
    if (start < end) selection = { input, fullText, start, end, text: fullText.slice(start, end) };
  };
  const findInput = () => Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea[data-composer-input]")).find(visible) ?? null;
  const insertAboveComposer = (input: HTMLTextAreaElement, content: HTMLDivElement) => {
    // HACK(Paseo 0.11): insert into the host layout until composer slots are public.
    const candidates = Array.from(document.querySelectorAll<HTMLElement>('button,[role="button"]'));
    const trigger = candidates.find((node) => node.textContent?.trim() === "澄清表达" && node.getBoundingClientRect().width > 0);
    if (!trigger) return false;
    let common: HTMLElement | null = input.parentElement;
    while (common && !common.contains(trigger)) common = common.parentElement;
    if (!common) return false;
    let composerWidth: string | null = null;
    for (let node = input.parentElement; node && node !== common; node = node.parentElement) {
      const maxWidth = window.getComputedStyle(node).maxWidth;
      if (maxWidth.endsWith("px") && Number.parseFloat(maxWidth) > 0) {
        composerWidth = maxWidth;
        break;
      }
    }
    content.style.maxWidth = composerWidth ?? `${input.getBoundingClientRect().width}px`;
    content.style.marginInline = "auto";
    let inputBranch: HTMLElement = input;
    while (inputBranch.parentElement && inputBranch.parentElement !== common) inputBranch = inputBranch.parentElement;
    common.insertBefore(content, inputBranch);
    const gapAbove = content.getBoundingClientRect().top - trigger.getBoundingClientRect().bottom;
    content.style.marginBottom = `${Math.max(0, Math.round(gapAbove))}px`;
    return true;
  };
  const close = () => { requestId++; card?.remove(); card = null; };
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text: string, style = "") => {
    const node = document.createElement(tag);
    node.textContent = text;
    node.style.cssText = style;
    return node;
  };
  const button = (label: string, onClick: () => void, primary = false) => {
    const isClose = label === "×";
    const border = isClose ? "none" : `1px solid ${primary ? "#176b42" : "#d1d5db"}`;
    const closeStyle = isClose ? "position:absolute;top:6px;right:8px;width:32px;height:32px;padding:0;font-size:24px;line-height:1;" : "padding:6px 11px;";
    const node = element("button", label, `cursor:pointer;border:${border};border-radius:7px;${closeStyle}background:${primary ? "#176b42" : "transparent"};color:${primary ? "#fff" : "inherit"};font:inherit;${isClose ? "font-size:24px;" : ""}`);
    node.type = "button";
    if (isClose) node.setAttribute("aria-label", "关闭建议");
    node.addEventListener("click", onClick);
    return node;
  };
  const addLine = (text: string, muted = false) => card?.append(element("div", text, `white-space:pre-wrap;overflow-wrap:anywhere;${muted ? "opacity:.7;font-size:12px;" : ""}`));
  const open = (agentId: string) => {
    capture();
    close();
    const chosen = selection && selection.input.isConnected && visible(selection.input) ? selection : null;
    const input = chosen?.input ?? findInput();
    if (!input) return;
    const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    card = document.createElement("div");
    card.dataset.vibeClarify = "";
    card.style.cssText = `position:relative;box-sizing:border-box;width:100%;max-height:45vh;overflow:auto;padding:14px 48px 14px 16px;display:flex;flex-direction:column;gap:9px;border-radius:9px;background:${dark ? "#20252c" : "#f8fafc"};color:${dark ? "#f8fafc" : "#1f2937"};font:13px system-ui,sans-serif`;
    if (!insertAboveComposer(input, card)) { card = null; return; }
    card.append(button("×", close));
    if (!chosen || chosen.fullText !== input.value) {
      addLine("先在消息输入框中选中要澄清的文字，再点击这个按钮。", true);
      return;
    }
    addLine(`原文：${chosen.text}`, true);
    addLine("正在整理措辞…", true);
    const id = ++requestId;
    void client.rpc(clarifyRpc, { agentId, text: chosen.text }).then((result) => {
      if (!card || id !== requestId) return;
      card.lastElementChild?.remove();
      addLine(result.suggestion);
      if (result.reason) addLine(result.reason, true);
      const actions = element("div", "", "display:flex;gap:8px;align-items:center");
      actions.append(button("采用建议", () => {
        if (!chosen.input.isConnected || chosen.input.value !== chosen.fullText) {
          addLine("输入内容已变化，请重新选中文字生成建议。", true);
          return;
        }
        const next = chosen.fullText.slice(0, chosen.start) + result.suggestion + chosen.fullText.slice(chosen.end);
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        setter?.call(chosen.input, next);
        chosen.input.dispatchEvent(new Event("input", { bubbles: true }));
        chosen.input.focus();
        chosen.input.setSelectionRange(chosen.start + result.suggestion.length, chosen.start + result.suggestion.length);
        selection = null;
        close();
      }, true), button("忽略", close));
      card.append(actions);
    }, (error: unknown) => {
      if (!card || id !== requestId) return;
      card.lastElementChild?.remove();
      addLine(error instanceof Error ? error.message : String(error));
    });
  };
  document.addEventListener("selectionchange", capture);
  document.addEventListener("select", capture, true);
  document.addEventListener("keyup", capture, true);
  document.addEventListener("mouseup", capture, true);
  return { open, dispose: () => {
    close();
    document.removeEventListener("selectionchange", capture);
    document.removeEventListener("select", capture, true);
    document.removeEventListener("keyup", capture, true);
    document.removeEventListener("mouseup", capture, true);
  } };
}
