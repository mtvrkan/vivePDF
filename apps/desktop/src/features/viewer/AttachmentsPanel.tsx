import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DropZone } from "@/components/tool/DropZone";
import { useDropPositionHandler } from "@/shared/hooks/useDropHandler";
import { FolderDown, Paperclip, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { SkeletonCard } from "@/components/shared/SkeletonCard";
import { cn } from "@/shared/lib/cn";
import { describeError } from "@/shared/lib/errorMessage";
import { formatBytes } from "@/shared/lib/format";
import { revealPath, RevealError } from "@/shared/lib/reveal";
import { toRpcError } from "@/shared/rpc/client";
import { extractAttachments, listAttachments } from "@/shared/rpc/operations";
import { useDocumentStore } from "@/shared/store/documentStore";
import { addedAttachmentNames, isAttachmentRemoved, pendingChangesFor, usePendingChangesStore } from "@/shared/store/pendingChangesStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useUiStore } from "@/shared/store/uiStore";
import type { AttachmentItem, AttachmentsListResult } from "@/types";

function basename(filePath: string) {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

export function AttachmentsPanel({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const toast = useToastStore((state) => state.push);
  const document = useDocumentStore((state) => state.documents[documentId] ?? null);
  const queue = usePendingChangesStore((state) => state.queue);
  const allChanges = usePendingChangesStore((state) => state.changes);
  const changes = useMemo(() => pendingChangesFor(allChanges, documentId), [allChanges, documentId]);
  const [data, setData] = useState<AttachmentsListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const path = document?.path ?? null;
  const password = document?.password ?? undefined;

  const loadRequest = useRef(0);

  const load = useCallback(async () => {
    if (!path) return;
    const request = ++loadRequest.current;
    setLoading(true);
    setError(null);
    try {
      const result = await listAttachments({ path, password });
      if (request === loadRequest.current) setData(result);
    } catch (caught) {
      if (request === loadRequest.current) setError(describeError(t, toRpcError(caught)));
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  }, [path, password, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const requestAttach = useCallback(
    (files: string[]) => {
      if (!path || files.length === 0) return;
      queue(documentId, { kind: "attachmentAdded", files, label: files.map(basename).join(", ") });
    },
    [path, queue, documentId],
  );
  const panelRef = useRef<HTMLElement>(null);
  const onDrop = useCallback(
    (paths: string[], position: { x: number; y: number }) => {
      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return false;
      const x = position.x / window.devicePixelRatio;
      const y = position.y / window.devicePixelRatio;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return false;
      requestAttach(paths);
      return true;
    },
    [requestAttach],
  );
  useDropPositionHandler(onDrop);

  const add = async () => {
    if (!path) return;
    const selected = await openDialog({ multiple: true, directory: false });
    if (!selected) return;
    requestAttach(Array.isArray(selected) ? selected : [selected]);
  };

  const extract = async (items: AttachmentItem[]) => {
    if (!path || items.length === 0) return;
    const folder = await openDialog({ directory: true, multiple: false });
    if (typeof folder !== "string") return;
    setBusy(true);
    try {
      const result = await extractAttachments({ path, password, names: items.map((item) => item.name), outputDir: folder });
      toast("success", t("viewer.attachments.extracted", { count: result.outputs.length }));
      if (result.outputs[0]) {
        try {
          await revealPath(result.outputs[0]);
        } catch (revealError) {
          const reasonKey = revealError instanceof RevealError ? revealError.reasonKey : "errors.revealFailed";
          toast("error", t(reasonKey));
        }
      }
    } catch (caught) {
      toast("error", describeError(t, toRpcError(caught)));
    } finally {
      setBusy(false);
    }
  };

  const requestDelete = (item: AttachmentItem) => {
    queue(documentId, { kind: "attachmentRemoved", names: [item.name], label: item.fileName });
  };

  const items = data?.items ?? [];
  const addedFiles = useMemo(() => addedAttachmentNames(changes), [changes]);
  const totalCount = items.filter((item) => !isAttachmentRemoved(changes, item.name)).length + addedFiles.length;
  const extractable = items.filter((item) => !isAttachmentRemoved(changes, item.name));

  return (
    <aside ref={panelRef} aria-label={t("viewer.attachments.title")} className="flex h-full w-inspector flex-col border-e bg-card">
      <div className="flex h-row items-center gap-2 border-b px-3">
        <Paperclip className="size-4 text-primary" aria-hidden />
        <span className="flex-1 text-sm font-semibold">{t("viewer.attachments.title")}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{data ? t("viewer.attachments.count", { count: totalCount }) : ""}</span>
        <IconButton icon={RefreshCw} label={t("viewer.comments.refresh")} onClick={() => void load()} disabled={loading} />
      </div>
      <DropZone label={t("tools.dropZone.files")} className="min-h-0 flex-1 overflow-auto rounded-none p-2">
        {loading && !data ? <SkeletonCard lines={5} /> : null}
        {error ? <p className="p-2 text-sm text-destructive">{error}</p> : null}
        {data && items.length === 0 && addedFiles.length === 0 ? (
          <div className="flex flex-col gap-1 p-3 text-sm text-muted-foreground">
            <span>{t("viewer.attachments.empty")}</span>
            <span className="text-xs">{t("viewer.attachments.hint")}</span>
          </div>
        ) : null}
        <ul className="flex flex-col gap-1.5">
          {items.map((item) => {
            const removed = isAttachmentRemoved(changes, item.name);
            return (
              <li key={item.name} className={cn("nav-glass rounded-xl px-3 py-2 text-sm", removed ? "opacity-50 line-through" : "")}>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium" title={item.fileName}>{item.fileName}</span>
                  {removed ? <span className="glass-chip shrink-0 text-[10px] text-muted-foreground">{t("viewer.pending.unsaved")}</span> : null}
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{formatBytes(item.size, locale)}</span>
                </div>
                {item.description ? <p title={item.description} className="mt-0.5 truncate text-xs text-muted-foreground">{item.description}</p> : null}
                <div className="mt-1 flex items-center justify-end gap-1">
                  <IconButton icon={FolderDown} label={t("viewer.attachments.extract")} disabled={busy || removed} onClick={() => void extract([item])} />
                  <IconButton icon={Trash2} label={t("viewer.attachments.delete")} disabled={busy || removed} onClick={() => requestDelete(item)} />
                </div>
              </li>
            );
          })}
          {addedFiles.map((file) => (
            <li key={file} className="nav-glass rounded-xl px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium" title={file}>{basename(file)}</span>
                <span className="glass-chip shrink-0 text-[10px] text-muted-foreground">{t("viewer.pending.unsaved")}</span>
              </div>
            </li>
          ))}
        </ul>
      </DropZone>
      <div className="flex items-center gap-2 border-t p-3">
        <Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => void add()} disabled={busy || !path}>
          {t("viewer.attachments.add")}
        </Button>
        <Button size="sm" variant="ghost" icon={<FolderDown className="size-4" aria-hidden />} onClick={() => void extract(extractable)} disabled={busy || extractable.length === 0}>
          {t("viewer.attachments.extractAll")}
        </Button>
      </div>
    </aside>
  );
}
