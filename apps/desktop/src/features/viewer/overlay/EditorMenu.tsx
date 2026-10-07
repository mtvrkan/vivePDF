import { FilePenLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { useViewerOverlayStore } from "@/shared/store/viewerOverlayStore";
import { isEditingMode, switchOverlayMode } from "./editorModes";

export function EditorMenu() {
  const { t } = useTranslation();
  const mode = useViewerOverlayStore((state) => state.mode);
  const active = isEditingMode(mode);
  return <IconButton icon={FilePenLine} label={t("viewer.overlay.editMenu")} active={active} onClick={() => switchOverlayMode(active ? null : "text")} />;
}
