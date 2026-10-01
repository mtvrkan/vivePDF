import { useEffect, useRef, useState, type ReactNode } from "react";
import { Minimize } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { exitImmersive } from "@/features/viewer/immersive";
import { cn } from "@/shared/lib/cn";
import { useUiStore } from "@/shared/store/uiStore";
import { WatchRunner } from "@/features/tools/watch/WatchRunner";
import { TrayBridge } from "@/features/tools/watch/TrayBridge";
import { isMainWindow } from "@/shared/lib/windowRole";
import { WindowQuitBridge } from "@/shared/session/WindowQuitBridge";
import { CommandPalette } from "./CommandPalette";
import { EngineBanner } from "./EngineBanner";
import { TopBar } from "./TopBar";

const EXIT_HIDE_DELAY_MS = 2500;

function ImmersiveExitAffordance() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(true);
  const hideTimer = useRef<number | null>(null);

  const scheduleHide = () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setVisible(false), EXIT_HIDE_DELAY_MS);
  };

  useEffect(() => {
    const onMove = () => {
      setVisible(true);
      scheduleHide();
    };
    window.addEventListener("mousemove", onMove);
    scheduleHide();
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    };
  }, []);

  return (
    <div
      onMouseEnter={() => {
        if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
        setVisible(true);
      }}
      onMouseLeave={scheduleHide}
      className={cn(
        "pointer-events-none fixed right-4 top-4 z-40 transition-[opacity,transform] duration-200",
        visible ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0",
      )}
    >
      <div className="pointer-events-auto">
        <IconButton icon={Minimize} label={t("viewer.exitFullscreen")} onClick={() => void exitImmersive()} />
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const immersive = useUiStore((state) => state.immersive);

  return (
    <>
      {immersive ? (
        <div className="h-full bg-background">
          <main className="h-full overflow-auto bg-background">{children}</main>
          <ImmersiveExitAffordance />
          <CommandPalette />
        </div>
      ) : (
        <div className="ambient grid h-full grid-rows-[var(--spacing-topbar)_1fr] grid-cols-[minmax(0,1fr)]">
          <TopBar />
          <div className="flex min-h-0 min-w-0 flex-col">
            <EngineBanner />
            <main className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</main>
          </div>
          <CommandPalette />
        </div>
      )}
      {isMainWindow() ? (
        <>
          <WatchRunner />
          <TrayBridge />
        </>
      ) : (
        <WindowQuitBridge />
      )}
    </>
  );
}
