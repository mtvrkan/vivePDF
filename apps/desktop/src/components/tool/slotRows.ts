export const MAX_SLOT_ROWS = 4;

export function slotRows(value: string): number {
  return Math.min(MAX_SLOT_ROWS, Math.max(1, value.split(/\r\n|\r|\n/).length));
}
