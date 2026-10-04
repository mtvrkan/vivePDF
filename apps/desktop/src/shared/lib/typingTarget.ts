const NON_TEXT_INPUTS = new Set(["range", "checkbox", "radio", "button", "submit", "reset", "color", "file", "image"]);
const CONTROL_ROLES = new Set(["button", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "radio", "checkbox", "switch", "slider", "treeitem", "gridcell", "link"]);

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
}

export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
  return target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
}

export function isControlTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === "BUTTON" || target.tagName === "A" || target.tagName === "SUMMARY" || target instanceof HTMLInputElement) return true;
  const role = target.getAttribute("role");
  return role !== null && CONTROL_ROLES.has(role);
}
