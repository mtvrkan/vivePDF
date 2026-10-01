export function isInAppPath(value: string): boolean {
  return value.startsWith("/") && value[1] !== "/" && value[1] !== "\\";
}
