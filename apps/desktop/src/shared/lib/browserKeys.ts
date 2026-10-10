import { isMac } from "@/shared/lib/platform";

type BrowserKey = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

const NAVIGATION_KEYS = new Set(["BrowserBack", "BrowserForward", "BrowserRefresh", "BrowserHome", "BrowserSearch", "BrowserFavorites", "BrowserStop"]);
const MODIFIED_BROWSER_KEYS = new Set(["r", "f", "g", "p", "s", "j", "h", "n", "t"]);
const DEVELOPER_KEYS = new Set(["i", "j", "c"]);

export function isBrowserShortcut(event: BrowserKey, allowDeveloperTools = false, mac = isMac): boolean {
  const key = event.key;
  const modifier = event.ctrlKey || event.metaKey;
  if (NAVIGATION_KEYS.has(key)) return true;
  if (key === "F5" || key === "F3" || key === "F7") return true;
  if (key === "F12") return !allowDeveloperTools;
  if (event.altKey && !modifier && (key === "ArrowLeft" || key === "ArrowRight" || key === "Home")) return true;
  if (!modifier || event.altKey) return false;
  const lower = key.toLowerCase();
  if (event.shiftKey && DEVELOPER_KEYS.has(lower)) return !allowDeveloperTools;
  if (mac && event.metaKey && !event.shiftKey && lower === "h") return false;
  return MODIFIED_BROWSER_KEYS.has(lower);
}

export function installBrowserKeyGuard(allowDeveloperTools: boolean): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (isBrowserShortcut(event, allowDeveloperTools)) event.preventDefault();
  };
  window.addEventListener("keydown", onKeyDown, true);
  return () => window.removeEventListener("keydown", onKeyDown, true);
}
