import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import { isMac } from "@/shared/lib/platform";
import { webviewZoomFactor } from "@/shared/lib/uiZoom";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import { runWindowCommand } from "@/shared/lib/windowCommand";

const MAC_FULLSCREEN_EVENT = "mac-fullscreen";

type LightSpot = { x: number; y: number; size: number };
type FullscreenChange = { fullscreen: boolean; lights: LightSpot[] };

function useFullscreenLights(): LightSpot[] | null {
  const [lights, setLights] = useState<LightSpot[] | null>(null);

  useEffect(() => {
    if (!isMac) return;
    let disposed = false;
    const apply = (change: FullscreenChange) => {
      if (!disposed) setLights(change.fullscreen && change.lights.length === 3 ? change.lights : null);
    };
    const unlisten = getCurrentWindow().listen<FullscreenChange>(MAC_FULLSCREEN_EVENT, (event) => apply(event.payload));
    invoke<FullscreenChange>("mac_fullscreen_state").then(apply).catch(() => undefined);
    return () => {
      disposed = true;
      void unlisten.then((stop) => stop()).catch(() => undefined);
    };
  }, []);

  return lights;
}

function useWindowFocused(active: boolean): boolean {
  const [focused, setFocused] = useState(true);

  useEffect(() => {
    if (!active) return;
    const appWindow = getCurrentWindow();
    void appWindow.isFocused().then(setFocused).catch(() => undefined);
    const unlisten = appWindow.onFocusChanged(({ payload }) => setFocused(payload));
    return () => {
      void unlisten.then((stop) => stop()).catch(() => undefined);
    };
  }, [active]);

  return focused;
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden className="size-full opacity-0 transition-opacity duration-(--transition-fast) group-hover/lights:opacity-100">
      <path d="M3.6 3.6l4.8 4.8M8.4 3.6l-4.8 4.8" className="stroke-traffic-glyph" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function ExitGlyph() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden className="size-full opacity-0 transition-opacity duration-(--transition-fast) group-hover/lights:opacity-100">
      <path d="M6.6 2.7v2.7h2.7zM5.4 9.3V6.6H2.7z" className="fill-traffic-glyph" />
    </svg>
  );
}

export function MacFullscreenLights() {
  const { t } = useTranslation();
  const lights = useFullscreenLights();
  const focused = useWindowFocused(lights !== null);
  const uiZoom = usePreferencesStore((state) => state.uiZoom);
  if (!lights) return null;

  const scale = webviewZoomFactor(uiZoom);
  const [close, minimize, zoom] = lights.map((spot) => ({ left: spot.x / scale, top: spot.y / scale, size: spot.size / scale }));
  const left = close.left;
  const top = Math.min(close.top, minimize.top, zoom.top);
  const place = (spot: typeof close) => ({ left: spot.left - left, top: spot.top - top, width: spot.size, height: spot.size });
  const light = "absolute rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="group/lights absolute z-10" style={{ left, top, width: zoom.left + zoom.size - left, height: Math.max(close.size, zoom.size) }}>
      <button
        type="button"
        aria-label={t("window.close")}
        onClick={() => runWindowCommand(() => getCurrentWindow().close())}
        style={place(close)}
        className={cn(light, focused ? "bg-traffic-close" : "bg-traffic-idle group-hover/lights:bg-traffic-close")}
      >
        <CloseGlyph />
      </button>
      <button type="button" aria-label={t("window.minimize")} disabled style={place(minimize)} className={cn(light, "bg-traffic-idle")} />
      <button
        type="button"
        aria-label={t("viewer.exitFullscreen")}
        onClick={() => runWindowCommand(() => getCurrentWindow().setFullscreen(false))}
        style={place(zoom)}
        className={cn(light, focused ? "bg-traffic-zoom" : "bg-traffic-idle group-hover/lights:bg-traffic-zoom")}
      >
        <ExitGlyph />
      </button>
    </div>
  );
}
