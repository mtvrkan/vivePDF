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
import App from "@/app/App";

installBlobUrlGuard();
removeRetiredSettings();
applyStoredTheme();
applyStoredPreferences();
installUiZoomShortcuts();
installBrowserKeyGuard(import.meta.env.DEV);

void Promise.all([ready(), loadSessionFile()]).then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
