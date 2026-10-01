export type DigitJumpState = { buffer: string };

const RESET_MS = 1200;

export function isJumpDigit(key: string): boolean {
  return /^[0-9]$/.test(key);
}

export function appendDigit(state: DigitJumpState, digit: string): DigitJumpState {
  const next = (state.buffer + digit).replace(/^0+(?=\d)/, "");
  return { buffer: next.slice(0, 6) };
}

export function resolveJumpPage(state: DigitJumpState, totalPages: number): number | null {
  const value = Number.parseInt(state.buffer, 10);
  if (!Number.isFinite(value) || value < 1) return null;
  return Math.min(value, totalPages);
}

export function emptyJumpState(): DigitJumpState {
  return { buffer: "" };
}

export function jumpResetDelayMs(): number {
  return RESET_MS;
}
