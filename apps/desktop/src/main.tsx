import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@/styles/globals.css";
import { ready } from "@/app/i18n";
import { applyStoredTheme } from "@/app/theme";
import { applyStoredPreferences } from "@/shared/store/preferencesStore";
import { removeRetiredSettings } from "@/shared/lib/retiredSettings";
import { installBlobUrlGuard } from "@/shared/lib/blobUrlGuard";
import { installBrowserKeyGuard } from "@/shared/lib/browserKeys";
import { installUiZoomShortcuts } from "@/shared/lib/uiZoomShortcuts";
import { loadSessionFile } from "@/shared/session/sessionStore";
import { adoptKnownPaths } from "@/shared/session/grantAdoption";
import { isAudienceWindow } from "@/shared/lib/windowRole";
import App from "@/app/App";

const mount = (app: React.ReactNode) => ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<React.StrictMode>{app}</React.StrictMode>);

const audience = isAudienceWindow();

installBlobUrlGuard();
if (!audience) removeRetiredSettings();
applyStoredTheme();
if (!audience) {
  applyStoredPreferences();
  installUiZoomShortcuts();
}
installBrowserKeyGuard(import.meta.env.DEV);

if (audience) void Promise.all([ready(), import("@/features/presenter/AudienceApp")]).then(([, { AudienceApp }]) => mount(<AudienceApp />));
else void Promise.all([ready(), loadSessionFile().then(adoptKnownPaths)]).then(() => mount(<App />));
