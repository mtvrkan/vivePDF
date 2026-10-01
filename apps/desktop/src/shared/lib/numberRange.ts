export type NumberRange = { min: number; max: number };

export function withinRange(value: number, range: NumberRange): boolean {
  return Number.isFinite(value) && value >= range.min && value <= range.max;
}

export function wholeWithin(value: number, range: NumberRange): boolean {
  return Number.isInteger(value) && withinRange(value, range);
}
