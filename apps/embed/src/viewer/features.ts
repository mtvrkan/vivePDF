export type ViewerFeatures = { print: boolean; download: boolean; toolbar: boolean };

const OFF = new Set(["false", "off", "no", "0", "none", "hidden"]);

export function parseSwitch(value: string | null): boolean {
  return value === null || !OFF.has(value.trim().toLowerCase());
}
