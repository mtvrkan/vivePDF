import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useShortcutSheetStore } from "@/features/about/shortcutSheetStore";
import { exitImmersive } from "@/features/viewer/immersive";
import { useUiStore } from "@/shared/store/uiStore";
import { helpTopicFor, isHelpTopicKey } from "./helpTopics";

export function HelpKeyListener() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isHelpTopicKey(event)) return;
      event.preventDefault();
      if (pathname === "/help") return;
      const immersive = useUiStore.getState().immersive;
      const topic = helpTopicFor(pathname, immersive, useShortcutSheetStore.getState().studioScreen);
      useShortcutSheetStore.getState().close();
      if (immersive) void exitImmersive();
      void navigate(`/help?topic=${topic}`);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, pathname]);

  return null;
}
