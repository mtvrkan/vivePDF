import { useEffect, useState } from "react";
import { Palette, X } from "lucide-react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { studioDesignOf } from "@/shared/rpc/operations";
import { useDocumentMessagesStore } from "@/shared/store/documentMessagesStore";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useStudioLaunchStore } from "@/shared/store/studioLaunchStore";
import { MessageRow } from "./MessageRow";

export function StudioDesignMessage({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const document = useDocumentStore((state) => state.documents[documentId] ?? null);
  const dismissed = useDocumentMessagesStore((state) => state.dismissed[documentId]?.includes("studio") ?? false);
  const dismiss = useDocumentMessagesStore((state) => state.dismiss);
  const [foundPath, setFoundPath] = useState<string | null>(null);
  const path = document?.path ?? null;
  const password = document?.password ?? null;
  const info = document?.info ?? null;

  useEffect(() => {
    if (!path || !info) return;
    let live = true;
    void studioDesignOf({ path, password }).then(
      (result) => {
        if (live) setFoundPath(result.found ? path : null);
      },
      () => {
        if (live) setFoundPath(null);
      },
    );
    return () => {
      live = false;
    };
  }, [path, password, info]);

  if (!path || dismissed || foundPath !== path) return null;
  return (
    <MessageRow>
      <Palette className="size-4 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{t("viewer.messages.studio.present")}</span>
      <Button
        size="sm"
        variant="ghost"
        data-testid="edit-in-studio"
        onClick={() => {
          useStudioLaunchStore.getState().request({ path, password });
          void navigate("/studio");
        }}
      >
        {t("viewer.messages.studio.open")}
      </Button>
      <IconButton icon={X} label={t("viewer.messages.dismiss")} onClick={() => dismiss(documentId, "studio")} />
    </MessageRow>
  );
}
