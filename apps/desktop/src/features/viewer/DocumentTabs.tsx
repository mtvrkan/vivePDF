import { useState } from "react";
import { Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useActiveDocument, useOpenDocuments } from "@embedpdf/plugin-document-manager/react";
import { ContextMenu, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { useContextMenu } from "@/components/shared/useContextMenu";
import { cn } from "@/shared/lib/cn";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useToastStore } from "@/shared/store/toastStore";
import { describeError } from "@/shared/lib/errorMessage";
import { basenameOf } from "@/shared/lib/paths";
import { revealPath, RevealError } from "@/shared/lib/reveal";
import { toRpcError } from "@/shared/rpc/client";
import { insertPagesFrom } from "@/shared/rpc/operations";
import { PAGE_DRAG_TYPE } from "./ThumbnailSidebar";
import { useOpenPdf } from "./useOpenPdf";
import { useCloseDocuments } from "./useCloseDocuments";
import { useDocumentWindow } from "./useDocumentWindow";
import { useTabTearOff } from "./tabTearOff";
import { useViewerOverlayStore } from "@/shared/store/viewerOverlayStore";
import { isPendingChange } from "./overlay/pending";

export function DocumentTabs({ confirmLeave }: { confirmLeave?: (run: () => void) => void } = {}) {
  const { t } = useTranslation();
  const registered = useDocumentStore((state) => state.documents);
  const documents = useOpenDocuments().filter((doc) => registered[doc.id]);
  const { activeDocumentId } = useActiveDocument();
  const { activate, closeDocument, pickAndOpen, openPath } = useOpenPdf();
  const { closeDocuments, hasUnsavedWork } = useCloseDocuments();
  const toast = useToastStore((state) => state.push);
  const openWindow = useDocumentWindow();
  const menu = useContextMenu();
  const [menuDocId, setMenuDocId] = useState<string | null>(null);
  const requestLeave = useViewerOverlayStore((state) => state.requestLeave);
  const objects = useViewerOverlayStore((state) => state.objects);
  const hasPending = objects.filter(isPendingChange).length > 0;
  const guard = (run: () => void) => (confirmLeave ? confirmLeave(run) : run());
  const guardedActivate = (id: string) => requestLeave(() => guard(() => activate(id)), hasPending);
  const guardedClose = (ids: string[]) => requestLeave(() => guard(() => closeDocuments(ids)), hasPending && ids.includes(activeDocumentId ?? ""));

  const moveToWindow = async (id: string) => {
    const doc = registered[id];
    if (!doc) return;
    if (hasUnsavedWork(id) || (hasPending && id === activeDocumentId)) {
      toast("info", t("viewer.window.saveFirst", { name: doc.fileName }));
      return;
    }
    if (await openWindow([doc.path])) closeDocument(id);
  };
  const tearOff = useTabTearOff((id) => void moveToWindow(id));

  const dropPage = async (targetId: string, payload: string) => {
    let parsed: { documentId: string; page: number } | null = null;
    try {
      parsed = JSON.parse(payload) as { documentId: string; page: number };
    } catch {
      return;
    }
    if (!parsed || parsed.documentId === targetId) return;
    const source = registered[parsed.documentId];
    const target = registered[targetId];
    if (!source || !target) return;
    if (hasUnsavedWork(targetId)) {
      toast("info", t("viewer.saveBeforePageDrop", { name: target.fileName }));
      return;
    }
    try {
      await insertPagesFrom({ path: target.path, password: target.password ?? undefined, sourcePath: source.path, sourcePassword: source.password ?? undefined, sourcePages: [parsed.page], at: 0 });
      toast("success", t("viewer.pageMoved", { page: parsed.page, name: target.fileName }));
      closeDocument(targetId);
      await openPath(target.path);
    } catch (caught) {
      toast("error", describeError(t, toRpcError(caught)));
    }
  };

  return (
    <div className="flex h-9 items-stretch overflow-x-auto glass-flat border-b">
      <div role="tablist" aria-label={t("viewer.tabs")} className="flex items-stretch">
      {documents.map((doc) => {
        const active = doc.id === activeDocumentId;
        return (
          <div
            key={doc.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            aria-keyshortcuts="Delete"
            onPointerDown={(event) => {
              if (event.target instanceof Element && event.target.closest("[data-tab-close]")) return;
              tearOff.onPointerDown(doc.id, event);
            }}
            onClick={() => {
              if (!tearOff.consumeDrag()) guardedActivate(doc.id);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                guardedActivate(doc.id);
              } else if (event.key === "Delete") {
                event.preventDefault();
                guardedClose([doc.id]);
              } else if (event.key === "ArrowRight" || event.key === "ArrowLeft" || event.key === "Home" || event.key === "End") {
                event.preventDefault();
                const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []);
                const index = tabs.indexOf(event.currentTarget);
                const step = event.key === "ArrowRight" ? 1 : -1;
                const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + step + tabs.length) % tabs.length;
                const next = documents[nextIndex];
                tabs[nextIndex]?.focus();
                if (next) guardedActivate(next.id);
              }
            }}
            onAuxClick={(event) => {
              if (event.button === 1) guardedClose([doc.id]);
            }}
            onContextMenu={(event) => {
              setMenuDocId(doc.id);
              menu.open(event);
            }}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes(PAGE_DRAG_TYPE)) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
              }
            }}
            onDrop={(event) => {
              const payload = event.dataTransfer.getData(PAGE_DRAG_TYPE);
              if (!payload) return;
              event.preventDefault();
              void dropPage(doc.id, payload);
            }}
            className={cn(
              "group relative flex max-w-56 min-w-32 select-none items-center gap-2 border-b-2 px-3 text-sm outline-none transition-colors duration-(--transition-fast) focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              active
                ? "border-b-primary bg-primary/8 font-medium text-foreground"
                : "border-b-transparent text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
              tearOff.draggingId === doc.id && "cursor-grabbing opacity-60",
            )}
          >
            <span className="min-w-0 flex-1 truncate" title={doc.name}>
              {doc.name}
            </span>
            <span
              aria-hidden
              data-tab-close=""
              title={`${t("common.close")}: ${doc.name}`}
              onClick={(event) => {
                event.stopPropagation();
                guardedClose([doc.id]);
              }}
              className={cn(
                "-me-1.5 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-(--hover-bg) hover:text-foreground group-hover:opacity-100 group-focus-visible:opacity-100",
                active ? "opacity-100" : "opacity-0",
              )}
            >
              <X className="size-3.5" aria-hidden />
            </span>
          </div>
        );
      })}
      </div>
      <button
        type="button"
        onClick={() => void pickAndOpen()}
        aria-label={t("common.openPdf")}
        title={t("common.openPdf")}
        className="nav-glass mx-1 my-1 flex w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
      >
        <Plus className="size-4" aria-hidden />
      </button>
      {menu.anchor && menuDocId
        ? (() => {
            const doc = documents.find((entry) => entry.id === menuDocId);
            const path = doc ? (registered[doc.id]?.path ?? "") : "";
            const items: ContextMenuItem[] = [
              { type: "item", id: "close", label: t("common.close"), onSelect: () => guardedClose([menuDocId]) },
              {
                type: "item",
                id: "close-others",
                label: t("viewer.context.closeOthers"),
                onSelect: () => guardedClose(documents.filter((entry) => entry.id !== menuDocId).map((entry) => entry.id)),
              },
              { type: "item", id: "close-all", label: t("viewer.context.closeAll"), onSelect: () => guardedClose(documents.map((entry) => entry.id)) },
              { type: "separator", id: "sep-window" },
              { type: "item", id: "move-to-window", label: t("viewer.window.moveToNew"), onSelect: () => void moveToWindow(menuDocId) },
              { type: "separator", id: "sep-file" },
              {
                type: "item",
                id: "show-in-folder",
                label: t("tools.reveal"),
                onSelect: () =>
                  void revealPath(path).catch((error) => toast("error", t(error instanceof RevealError ? error.reasonKey : "errors.revealFailed"))),
              },
              { type: "item", id: "copy-path", label: t("viewer.context.copyPath"), onSelect: () => void navigator.clipboard.writeText(path) },
              { type: "item", id: "copy-name", label: t("viewer.context.copyFileName"), onSelect: () => void navigator.clipboard.writeText(basenameOf(path)) },
            ];
            return <ContextMenu anchor={menu.anchor} items={items} label={t("viewer.tabs")} onClose={menu.close} />;
          })()
        : null}
    </div>
  );
}
