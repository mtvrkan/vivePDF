import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { useUiStore } from "@/shared/store/uiStore";
import { isShortcutSheetKey, shortcutGroupsFor, shortcutScreen } from "./screenShortcuts";
import { SaveShortcutsPdfButton } from "./SaveShortcutsPdfButton";
import { ShortcutList } from "./ShortcutList";
import { useShortcutSheetStore } from "./shortcutSheetStore";

export function ShortcutSheet() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const open = useShortcutSheetStore((state) => state.open);
  const studio = useShortcutSheetStore((state) => state.studioScreen);
  const close = useShortcutSheetStore((state) => state.close);
  const immersive = useUiStore((state) => state.immersive);
  const screen = shortcutScreen(pathname, immersive, studio);
  const groups = useMemo(() => shortcutGroupsFor(screen), [screen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isShortcutSheetKey(event)) return;
      event.preventDefault();
      useShortcutSheetStore.getState().toggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const showAll = () => {
    close();
    void navigate("/about?tab=shortcuts");
  };

  return (
    <Dialog
      open={open}
      title={t("about.tabs.shortcuts")}
      onClose={close}
      size="xl"
      footer={
        <>
          <SaveShortcutsPdfButton groups={groups} />
          <Button variant="secondary" onClick={showAll}>
            {t("shortcutSheet.showAll")}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted-foreground">{t("shortcutSheet.intro", { screen: t(`shortcutSheet.screens.${screen}`) })}</p>
      {open ? <ShortcutList groups={groups} /> : null}
    </Dialog>
  );
}
