import type { TextEdit, TextSpan } from "@/types";

export const TEXT_EDIT_SIZE = { min: 4, max: 96 };

export function sameAsSpan(edit: TextEdit, span: TextSpan): boolean {
  return (
    edit.text === span.text &&
    edit.size === span.size &&
    edit.color.toLowerCase() === span.color.toLowerCase() &&
    (edit.bold ?? false) === span.bold &&
    (edit.italic ?? false) === span.italic &&
    (edit.opacity ?? 1) === (span.opacity ?? 1)
  );
}
