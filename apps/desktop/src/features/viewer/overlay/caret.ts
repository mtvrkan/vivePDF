export function caretRangeAt(root: HTMLElement, clientX: number, clientY: number): Range | null {
  const documentRef = root.ownerDocument;
  const withCaretRange = documentRef as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
  if (typeof withCaretRange.caretRangeFromPoint === "function") {
    const range = withCaretRange.caretRangeFromPoint(clientX, clientY);
    if (range && root.contains(range.startContainer)) return range;
    return null;
  }
  const withCaretPosition = documentRef as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  if (typeof withCaretPosition.caretPositionFromPoint === "function") {
    const position = withCaretPosition.caretPositionFromPoint(clientX, clientY);
    if (position && root.contains(position.offsetNode)) {
      const range = documentRef.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.collapse(true);
      return range;
    }
  }
  return null;
}

function textLengthOf(range: Range): number {
  const fragment = range.cloneContents();
  let length = 0;
  const walk = (node: ChildNode) => {
    if (node.nodeType === Node.TEXT_NODE) {
      length += (node.textContent ?? "").length;
      return;
    }
    if (node.nodeName === "BR") {
      length += 1;
      return;
    }
    node.childNodes.forEach(walk);
  };
  fragment.childNodes.forEach(walk);
  return length;
}

export function selectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const preStart = document.createRange();
  preStart.selectNodeContents(root);
  preStart.setEnd(range.startContainer, range.startOffset);
  const preEnd = document.createRange();
  preEnd.selectNodeContents(root);
  preEnd.setEnd(range.endContainer, range.endOffset);
  return { start: textLengthOf(preStart), end: textLengthOf(preEnd) };
}

function resolveOffset(root: HTMLElement, target: number): { node: Node; offset: number } {
  let remaining = target;
  let result: { node: Node; offset: number } | null = null;
  const walk = (node: ChildNode) => {
    if (result) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const length = (node.textContent ?? "").length;
      if (remaining <= length) {
        result = { node, offset: remaining };
        return;
      }
      remaining -= length;
      return;
    }
    if (node.nodeName === "BR") {
      if (remaining <= 0) {
        result = { node: node.parentNode ?? root, offset: 0 };
        return;
      }
      remaining -= 1;
      return;
    }
    node.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  return result ?? { node: root, offset: root.childNodes.length };
}

export function placeCaretAtOffsets(root: HTMLElement, start: number, end: number): void {
  const startPoint = resolveOffset(root, start);
  const endPoint = resolveOffset(root, end);
  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
}
