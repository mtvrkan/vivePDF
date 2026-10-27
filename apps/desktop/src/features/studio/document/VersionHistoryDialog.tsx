import { useCallback, useEffect, useState } from "react";
import { FileClock, FolderOpen, PencilLine, RotateCcw, Save, Timer, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EditorContent, useEditor } from "@tiptap/react";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { describeError } from "@/shared/lib/errorMessage";
import { cn } from "@/shared/lib/cn";
import { toRpcError } from "@/shared/rpc/client";
import { useToastStore } from "@/shared/store/toastStore";
import type { RpcError } from "@/types";
import type { StudioDocument } from "@/types/studio";
import { loadDocumentFont } from "./documentFonts";
import { useDocumentStore } from "./documentStore";
import { setHeadingNumbers } from "./headingNumbers";
import { paperStyleOf } from "./paperStyle";
import { useDocumentExtensions } from "./useDocumentExtensions";
import { listVersions, readVersion, restoreVersion, type DocumentVersion, type VersionKind } from "./versionHistory";

const CURRENT = "current";
const PREVIEW_ZOOM = 0.62;
const KIND_ICONS: Record<VersionKind, LucideIcon> = { open: FolderOpen, save: Save, auto: Timer, restore: RotateCcw };

type Listing = { status: "loading" } | { status: "ready"; versions: DocumentVersion[] } | { status: "error"; error: RpcError };
type Preview = { status: "loading" } | { status: "ready"; document: StudioDocument } | { status: "error"; error: RpcError };

function versionTime(savedAt: number, locale: string, now: Date = new Date()): string {
  const when = new Date(savedAt);
  const sameDay = when.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat(locale, sameDay ? { timeStyle: "short" } : { dateStyle: "medium", timeStyle: "short" }).format(when);
}

function sizeOf(bytes: number, locale: string): string {
  const kilobytes = bytes / 1024;
  const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  return kilobytes >= 1024 ? `${format.format(kilobytes / 1024)} MB` : `${format.format(Math.max(1, kilobytes))} KB`;
}

function VersionRow({ icon: Icon, title, detail, selected, onSelect, testId }: { icon: LucideIcon; title: string; detail: string; selected: boolean; onSelect: () => void; testId: string }) {
  return (
    <li>
      <button
        type="button"
        aria-current={selected || undefined}
        onClick={onSelect}
        className={cn("flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-start transition-colors duration-(--transition-fast) hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary", selected && "bg-primary/10 hover:bg-primary/10")}
        data-testid={testId}
      >
        <span aria-hidden className={cn("grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground", selected && "bg-primary/15 text-primary")}>
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{title}</span>
          <span className="block truncate text-xs text-muted-foreground">{detail}</span>
        </span>
      </button>
    </li>
  );
}

function ListSkeleton() {
  return (
    <ul className="flex flex-col gap-1 p-2" aria-hidden data-testid="versions-loading">
      {[0, 1, 2, 3, 4].map((row) => (
        <li key={row} className="flex items-center gap-3 px-2.5 py-2">
          <span className="size-8 shrink-0 animate-pulse rounded-lg bg-muted" />
          <span className="flex flex-1 flex-col gap-1.5">
            <span className="h-3 w-3/4 animate-pulse rounded bg-muted" />
            <span className="h-2.5 w-1/2 animate-pulse rounded bg-muted" />
          </span>
        </li>
      ))}
    </ul>
  );
}

function VersionPaper({ document, language, label }: { document: StudioDocument; language: string; label: string }) {
  const extensions = useDocumentExtensions(language, document);
  const headingNumbers = document.settings.headingNumbers ?? "none";
  const editor = useEditor(
    {
      extensions,
      content: document.content,
      editable: false,
      editorProps: { attributes: { class: "vp-doc-body", "aria-label": label, lang: language, "data-testid": "version-preview-body" } },
      onCreate: ({ editor: created }) => created.view.dispatch(setHeadingNumbers(created.state, headingNumbers)),
    },
    [document, extensions, headingNumbers],
  );

  useEffect(() => {
    void loadDocumentFont(document.settings.fontId);
    if (document.settings.headingFontId) void loadDocumentFont(document.settings.headingFontId);
  }, [document.settings.fontId, document.settings.headingFontId]);

  return (
    <div className="paper-surface vp-doc pointer-events-none relative mx-auto bg-white shadow-md select-none" style={paperStyleOf(document.settings, PREVIEW_ZOOM)} data-testid="version-preview-paper">
      <EditorContent editor={editor} />
    </div>
  );
}

function PreviewPane({ preview, language, label, onRetry }: { preview: Preview; language: string; label: string; onRetry: () => void }) {
  const { t } = useTranslation();
  if (preview.status === "error") return <ErrorState title={t("studio.doc.versions.previewError")} message={describeError(t, preview.error)} onRetry={onRetry} />;
  if (preview.status === "loading")
    return (
      <div className="mx-auto flex h-96 w-72 flex-col gap-2 rounded-sm bg-card p-8 shadow-md" aria-hidden data-testid="version-preview-loading">
        <span className="mb-2 h-4 w-2/3 animate-pulse rounded bg-muted" />
        <span className="h-2.5 w-full animate-pulse rounded bg-muted" />
        <span className="h-2.5 w-4/5 animate-pulse rounded bg-muted" />
        <span className="h-2.5 w-3/5 animate-pulse rounded bg-muted" />
      </div>
    );
  return <VersionPaper document={preview.document} language={language} label={label} />;
}

export function VersionHistoryDialog({ open, onClose, onSave, language }: { open: boolean; onClose: () => void; onSave: () => void; language: string }) {
  const { t } = useTranslation();
  const filePath = useDocumentStore((state) => state.filePath);
  const dirty = useDocumentStore((state) => state.dirty);
  const [listing, setListing] = useState<Listing>({ status: "loading" });
  const [selected, setSelected] = useState(CURRENT);
  const [preview, setPreview] = useState<Preview>({ status: "loading" });
  const [restoring, setRestoring] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(() => {
    if (!filePath) return () => undefined;
    let live = true;
    setListing({ status: "loading" });
    listVersions(filePath).then(
      (versions) => live && setListing({ status: "ready", versions }),
      (error: unknown) => live && setListing({ status: "error", error: toRpcError(error) }),
    );
    return () => {
      live = false;
    };
  }, [filePath]);

  useEffect(() => {
    if (!open) return;
    setSelected(CURRENT);
    return load();
  }, [open, load]);

  useEffect(() => {
    if (!open || !filePath) return;
    if (selected === CURRENT) {
      useDocumentStore.getState().flushContent();
      const document = useDocumentStore.getState().document;
      setPreview(document ? { status: "ready", document } : { status: "loading" });
      return;
    }
    let live = true;
    setPreview({ status: "loading" });
    readVersion(filePath, selected).then(
      (document) => live && setPreview(document ? { status: "ready", document } : { status: "error", error: { code: "FILE_NOT_FOUND", message: "version missing" } }),
      (error: unknown) => live && setPreview({ status: "error", error: toRpcError(error) }),
    );
    return () => {
      live = false;
    };
  }, [open, filePath, selected, attempt]);

  const versions = listing.status === "ready" ? listing.versions : [];
  const chosen = versions.find((version) => version.id === selected);
  const kindLabel = (kind: VersionKind) => t(`studio.doc.versions.kinds.${kind}`);
  const titleOf = (version: DocumentVersion | undefined) => (version ? versionTime(version.savedAt, language) : t("studio.doc.versions.current"));

  const restore = async () => {
    if (!filePath || !chosen) return;
    setRestoring(true);
    try {
      if (await restoreVersion(filePath, chosen.id)) {
        useToastStore.getState().push("success", t("studio.doc.versions.restored", { time: versionTime(chosen.savedAt, language) }));
        onClose();
      } else {
        useToastStore.getState().push("error", t("studio.doc.versions.missing"));
        setSelected(CURRENT);
        load();
      }
    } catch (error) {
      useToastStore.getState().push("error", describeError(t, toRpcError(error)));
    } finally {
      setRestoring(false);
    }
  };

  const body = !filePath ? (
    <EmptyState
      icon={FileClock}
      title={t("studio.doc.versions.emptyTitle")}
      description={t("studio.doc.versions.emptyBody")}
      action={
        <Button
          size="sm"
          icon={<Save className="size-3.5" aria-hidden />}
          onClick={() => {
            onClose();
            onSave();
          }}
          data-testid="versions-save"
        >
          {t("studio.doc.versions.saveNow")}
        </Button>
      }
    />
  ) : listing.status === "error" ? (
    <ErrorState title={t("studio.doc.versions.loadError")} message={describeError(t, listing.error)} onRetry={() => void load()} />
  ) : (
    <div className="-mx-5 -mb-4 flex h-[70vh] min-h-0 border-t border-border">
      <div className="flex w-64 shrink-0 flex-col border-e border-border">
        {listing.status === "loading" ? (
          <ListSkeleton />
        ) : (
          <ul aria-label={t("studio.doc.versions.listLabel")} className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2" data-testid="versions-list">
            <VersionRow icon={PencilLine} title={t("studio.doc.versions.current")} detail={t(dirty ? "studio.doc.versions.currentUnsaved" : "studio.doc.versions.currentSaved")} selected={selected === CURRENT} onSelect={() => setSelected(CURRENT)} testId="versions-current" />
            {versions.map((version) => (
              <VersionRow key={version.id} icon={KIND_ICONS[version.kind]} title={versionTime(version.savedAt, language)} detail={`${kindLabel(version.kind)} · ${sizeOf(version.bytes, language)}`} selected={selected === version.id} onSelect={() => setSelected(version.id)} testId="versions-item" />
            ))}
          </ul>
        )}
        <p className="shrink-0 border-t border-border px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">{t("studio.doc.versions.hint")}</p>
      </div>
      <section aria-label={t("studio.doc.versions.previewLabel", { name: titleOf(chosen) })} className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-medium">{titleOf(chosen)}</h3>
            <p className="truncate text-xs text-muted-foreground">{chosen ? kindLabel(chosen.kind) : t(dirty ? "studio.doc.versions.currentUnsaved" : "studio.doc.versions.currentSaved")}</p>
          </div>
          {chosen ? (
            <Button size="sm" variant="primary" loading={restoring} disabled={preview.status !== "ready"} icon={<RotateCcw className="size-3.5" aria-hidden />} onClick={() => void restore()} data-testid="versions-restore">
              {t("studio.doc.versions.restore")}
            </Button>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-muted/40 p-6" data-testid="version-preview">
          <PreviewPane preview={preview} language={language} label={t("studio.doc.versions.previewLabel", { name: titleOf(chosen) })} onRetry={() => setAttempt((value) => value + 1)} />
        </div>
      </section>
    </div>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title={t("studio.doc.versions.title")}
      footer={
        <Button variant="ghost" onClick={onClose}>
          {t("common.close")}
        </Button>
      }
    >
      <div data-testid="version-history">{body}</div>
    </Dialog>
  );
}
