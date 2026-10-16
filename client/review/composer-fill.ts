/** HACK(Paseo web): timeline renderers do not have a composer draft setter. */
export function fillVisibleComposer(text: string): boolean {
  if (typeof document === "undefined") return false;
  const isShown = (input: HTMLTextAreaElement) => {
    const rect = input.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const targets = (): HTMLTextAreaElement | null => {
    // ponytail: prefer the pane containing the focused element; falls back to a document-wide lookup.
    // Upgrade path: use Paseo's active-agent API when available instead of the activeElement heuristic.
    const active = document.activeElement;
    let node = active !== null && active !== undefined && typeof active === "object" ? active as Element : null;
    while (node) {
      const paneInputs = Array.from(node.querySelectorAll<HTMLTextAreaElement>("textarea[data-composer-input]")).filter(isShown);
      if (paneInputs.length === 1) return paneInputs[0];
      node = node.parentElement;
    }
    const inputs = Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea[data-composer-input]")).filter(isShown);
    // Multiple visible agent panes make a document-wide lookup ambiguous.
    return inputs.length === 1 ? inputs[0] : null;
  };
  const input = targets();
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (!setter) return false;
  setter.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
  input.setSelectionRange(text.length, text.length);
  return true;
}
