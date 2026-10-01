const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export type VisibilityCheck = (element: HTMLElement) => boolean;

export const isRendered: VisibilityCheck = (element) => element.getClientRects().length > 0;

export function focusableWithin(root: ParentNode, visible: VisibilityCheck = isRendered): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.tabIndex >= 0 && !element.closest("[inert],[hidden],[aria-hidden='true']") && visible(element),
  );
}

export function isTopmostModal(panel: Element | null, doc: Document = document): boolean {
  if (!panel) return false;
  const modals = doc.querySelectorAll("[aria-modal='true']");
  return modals[modals.length - 1] === panel;
}

export function wrapTabFocus(event: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">, root: HTMLElement, visible: VisibilityCheck = isRendered): boolean {
  if (event.key !== "Tab") return false;
  const active = root.ownerDocument.activeElement;
  const items = focusableWithin(root, visible);
  if (items.length === 0) {
    event.preventDefault();
    root.focus();
    return true;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const inside = active instanceof HTMLElement && root.contains(active);
  if (!inside) {
    if (active && active !== root.ownerDocument.body) return false;
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return true;
  }
  if (event.shiftKey && (active === first || active === root)) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}
