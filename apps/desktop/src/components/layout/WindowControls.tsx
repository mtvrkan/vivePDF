import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import { runWindowCommand } from "@/shared/lib/windowCommand";

export function WindowControls() {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    void appWindow.isMaximized().then(setMaximized).catch(() => undefined);
    const unlisten = appWindow.onResized(() => {
      void appWindow.isMaximized().then(setMaximized).catch(() => undefined);
    });
    return () => {
      void unlisten.then((stop) => stop()).catch(() => undefined);
    };
  }, []);

  const control =
    "flex h-full w-11 items-center justify-center text-muted-foreground transition-colors duration-(--transition-fast) hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

  return (
    <div className="ms-1 flex h-full shrink-0 items-stretch">
      <button type="button" aria-label={t("window.minimize")} onClick={() => runWindowCommand(() => getCurrentWindow().minimize())} className={control}>
        <Minus className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        aria-label={maximized ? t("window.restore") : t("window.maximize")}
        onClick={() => runWindowCommand(() => getCurrentWindow().toggleMaximize())}
        className={control}
      >
        {maximized ? <Copy className="size-3.5" aria-hidden /> : <Square className="size-3.5" aria-hidden />}
      </button>
      <button
        type="button"
        aria-label={t("window.close")}
        onClick={() => runWindowCommand(() => getCurrentWindow().close())}
        className={cn(control, "hover:bg-destructive hover:text-destructive-foreground")}
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
