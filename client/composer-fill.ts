/** HACK(Paseo web): timeline renderers do not have a composer draft setter. */
export function fillVisibleComposer(text: string): boolean {
  if (typeof document === "undefined") return false;
  const inputs = Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea[data-composer-input]")).filter((input) => {
    const rect = input.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  // Multiple visible agent panes make a document-wide lookup ambiguous.
  if (inputs.length !== 1) return false;
  const input = inputs[0];
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (!setter) return false;
  setter.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
  input.setSelectionRange(text.length, text.length);
  return true;
}
