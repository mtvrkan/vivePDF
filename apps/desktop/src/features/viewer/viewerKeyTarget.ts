const ACTIVATABLE_ROLES = new Set(["button", "link", "checkbox", "switch", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "option", "radio", "treeitem"]);
const COMPOSITE_SELECTOR = ["menu", "menubar", "tablist", "radiogroup", "listbox", "slider", "tree", "grid", "spinbutton"].map((role) => `[role="${role}"]`).join(",");
const PAGE_SCROLLER_SELECTOR = "[data-pan-scroller]";

export function isActivatableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === "BUTTON" || target.tagName === "A" || target.tagName === "SUMMARY") return true;
  const role = target.getAttribute("role");
  return role !== null && ACTIVATABLE_ROLES.has(role);
}

export function isInsideCompositeWidget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(COMPOSITE_SELECTOR) !== null;
}

export function hasOpenModal(root: ParentNode = document): boolean {
  return root.querySelector('[aria-modal="true"]') !== null;
}

export function hasTextSelectionOutsidePages(selection: Selection | null = window.getSelection()): boolean {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  const anchor = selection.anchorNode;
  const element = anchor instanceof Element ? anchor : (anchor?.parentElement ?? null);
  return element?.closest(PAGE_SCROLLER_SELECTOR) == null;
}
