import { FileWarning, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { numberedPath, pathKey } from "@/shared/lib/paths";
import { fileNameOf } from "@/shared/rpc/files";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useViewerOverlayStore } from "@/shared/store/viewerOverlayStore";
import { useFileChangeStore, type FileChangeStatus } from "./fileChangeStore";
import { MessageRow } from "./MessageRow";
import { useDocumentSave } from "./useDocumentSave";
import { useReloadDocument } from "./useReloadDocument";

export type BannerStatus = Exclude<FileChangeStatus, "stale">;

type FileChangedBannerProps = {
  status: BannerStatus;
  fileName: string;
  onReload: () => void;
  onDismiss: () => void;
  onSaveCopy: () => void;
};

export function FileChangedBanner({ status, fileName, onReload, onDismiss, onSaveCopy }: FileChangedBannerProps) {
  const { t } = useTranslation();
  const Icon = status === "missing" ? FileWarning : RefreshCw;
  return (
    <MessageRow tone={status === "changed" ? undefined : "invalid"}>
      <Icon className={status === "changed" ? "size-4 shrink-0 text-primary" : "size-4 shrink-0 text-destructive"} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{t(`viewer.fileChanged.${status}`, { name: fileName })}</span>
      {status === "missing" ? (
        <Button size="sm" variant="ghost" onClick={onSaveCopy}>
          {t("viewer.fileChanged.saveCopy")}
        </Button>
      ) : (
        <Button size="sm" variant="ghost" onClick={onReload}>
          {t("viewer.fileChanged.reload")}
        </Button>
      )}
      {status === "conflict" ? (
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          {t("viewer.fileChanged.keepMine")}
        </Button>
      ) : (
        <IconButton icon={X} label={t("viewer.messages.dismiss")} onClick={onDismiss} />
      )}
    </MessageRow>
  );
}

export function FileChangedMessage({ documentId }: { documentId: string }) {
  const path = useDocumentStore((state) => state.documents[documentId]?.path ?? null);
  const status = useFileChangeStore((state) => (path ? (state.statuses[pathKey(path)] ?? null) : null));
  if (!path || !status || status === "stale") return null;
  return <FileChangedRow documentId={documentId} path={path} status={status} />;
}

function FileChangedRow({ documentId, path, status }: { documentId: string; path: string; status: BannerStatus }) {
  const reload = useReloadDocument(documentId);
  const { save } = useDocumentSave(documentId);
  const clear = useFileChangeStore((state) => state.clear);

  const reloadFromDisk = async () => {
    const overlay = useViewerOverlayStore.getState();
    if (overlay.editingDocumentId === documentId) overlay.setMode(null);
    clear(path);
    await reload();
  };

  const saveCopy = async () => {
    const picked = await saveDialog({ defaultPath: numberedPath(path, 2), filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (!picked) return;
    const target = picked.toLowerCase().endsWith(".pdf") ? picked : `${picked}.pdf`;
    const saved = await save(target, pathKey(target) === pathKey(path));
    if (saved) clear(path);
  };

  return <FileChangedBanner status={status} fileName={fileNameOf(path)} onReload={() => void reloadFromDisk()} onDismiss={() => clear(path)} onSaveCopy={() => void saveCopy()} />;
}
