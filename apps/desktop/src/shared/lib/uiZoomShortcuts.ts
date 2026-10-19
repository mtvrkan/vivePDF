import i18n from "@/app/i18n";
import { stepUiZoom, uiZoomShortcutFor } from "@/shared/lib/uiZoom";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import { useToastStore } from "@/shared/store/toastStore";

type Scheduler = (run: () => void) => void;

const MENU_ECHO_MS = 400;

let lastAnnouncement: string | null = null;
let lastTrustedPress = 0;

function announce(percent: number): void {
  const toasts = useToastStore.getState();
  for (const toast of toasts.toasts) if (toast.message === lastAnnouncement) toasts.dismiss(toast.id);
  lastAnnouncement = i18n.t("settings.appearance.uiZoomChanged", { percent });
  toasts.push("info", lastAnnouncement);
}

export function handleUiZoomKey(event: KeyboardEvent, schedule: Scheduler = (run) => window.setTimeout(run, 0)): boolean {
  const shortcut = uiZoomShortcutFor(event);
  if (!shortcut || event.defaultPrevented) return false;
  if (event.isTrusted) lastTrustedPress = Date.now();
  else if (Date.now() - lastTrustedPress < MENU_ECHO_MS) return false;
  schedule(() => {
    if (event.defaultPrevented) return;
    const preferences = usePreferencesStore.getState();
    const next = stepUiZoom(preferences.uiZoom, shortcut);
    if (next !== preferences.uiZoom) preferences.update({ uiZoom: next });
    announce(Math.round(next * 100));
  });
  return true;
}

export function installUiZoomShortcuts(): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    handleUiZoomKey(event);
  };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
