import type { KeepInTray } from "@/shared/store/preferencesStore";

export function trayWanted(mode: KeepInTray, activeRules: number, trayByDefault: boolean): boolean {
  if (mode === "always") return true;
  if (mode === "off") return false;
  return trayByDefault && activeRules > 0;
}
