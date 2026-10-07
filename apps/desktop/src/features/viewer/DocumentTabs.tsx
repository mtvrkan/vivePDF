import { Fragment, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useActiveDocument, useOpenDocuments } from "@embedpdf/plugin-document-manager/react";
import { ContextMenu, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { useContextMenu } from "@/components/shared/useContextMenu";
import { cn } from "@/shared/lib/cn";
import { inTabOrder, useDocumentStore } from "@/shared/store/documentStore";
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
import { openBeside } from "./split/splitTargets";
import { useViewerOverlayStore } from "@/shared/store/viewerOverlayStore";
import { usePageDropTargetStore } from "@/shared/store/pageDropTargetStore";
import { isPendingChange } from "./overlay/pending";
import { useCollectionsStore } from "@/features/home/collectionsStore";
import { sessionPathOf } from "./convertedDocuments";
import { GROUP_COLORS, GROUP_TONES, groupAfterMove, groupNeighbour, groupedOrder, movedGroupOrder, tabOutsideGroup, useTabGroupStore, type TabGroup } from "./tabGroups";

type GroupDrag = { groupId: string; startX: number; moved: boolean; targetId: string | null; after: boolean; markX: number };

export function DocumentTabs({ confirmLeave }: { confirmLeave?: (run: () => void) => void } = {}) {
  const { t } = useTranslation();
  const registered = useDocumentStore((state) => state.documents);
  const order = useDocumentStore((state) => state.order);
  const documents = inTabOrder(useOpenDocuments().filter((doc) => registered[doc.id]), order);
  const stripRef = useRef<HTMLDivElement>(null);
  const groups = useTabGroupStore((state) => state.groups);
  const memberOf = useTabGroupStore((state) => state.memberOf);
  const groupMenu = useContextMenu();
  const [menuGroupId, setMenuGroupId] = useState<string | null>(null);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [groupDrag, setGroupDrag] = useState<GroupDrag | null>(null);
  const skipChipClick = useRef(false);
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
  const guardedActivate = (id: string) => requestLeave(() => activate(id), hasPending);
  const guardedClose = (ids: string[]) => {
    const closesActive = ids.includes(activeDocumentId ?? "");
    requestLeave(() => (closesActive ? guard(() => closeDocuments(ids)) : closeDocuments(ids)), hasPending && closesActive);
  };

  const moveToWindow = async (id: string) => {
    const doc = registered[id];
    if (!doc) return;
    if (hasUnsavedWork(id) || (hasPending && id === activeDocumentId)) {
      toast("info", t("viewer.window.saveFirst", { name: doc.fileName }));
      return;
    }
    if (await openWindow([doc.path])) closeDocument(id);
  };
  const regroup = () => {
    const store = useDocumentStore.getState();
    useDocumentStore.setState({ order: groupedOrder(store.order, useTabGroupStore.getState().memberOf) });
  };
  const reorderTo = (id: string, visibleIndex: number) => {
    const rest = documents.map((doc) => doc.id).filter((entry) => entry !== id);
    const full = useDocumentStore.getState().order.filter((entry) => entry !== id);
    const anchor = rest[visibleIndex];
    const last = rest[rest.length - 1];
    const toIndex = anchor ? full.indexOf(anchor) : last ? full.indexOf(last) + 1 : 0;
    useDocumentStore.getState().move(id, toIndex);
    const tabGroups = useTabGroupStore.getState();
    const target = groupAfterMove(useDocumentStore.getState().order, id, tabGroups.memberOf);
    if (target) tabGroups.join(id, target);
    else tabGroups.leave(id);
    regroup();
  };
  const groupWith = (id: string, target: string | null) => {
    const tabGroups = useTabGroupStore.getState();
    if (target) tabGroups.join(id, target);
    else tabGroups.create([id]);
    regroup();
  };

  useEffect(() => {
    for (const id of Object.keys(memberOf)) if (!registered[id]) useTabGroupStore.getState().forget(id);
  }, [memberOf, registered]);

  useEffect(() => {
    if (!activeDocumentId) return;
    const tabGroups = useTabGroupStore.getState();
    const group = tabGroups.groups.find((entry) => entry.id === tabGroups.memberOf[activeDocumentId]);
    if (group?.collapsed) tabGroups.setCollapsed(group.id, false);
  }, [activeDocumentId]);

  const moveGroup = (groupId: string, targetId: string, after: boolean) => {
    const store = useDocumentStore.getState();
    useDocumentStore.setState({ order: movedGroupOrder(store.order, useTabGroupStore.getState().memberOf, groupId, targetId, after) });
  };
  const moveGroupBy = (groupId: string, step: number) => {
    const { order } = useDocumentStore.getState();
    const visible = new Set(documents.map((doc) => doc.id));
    const neighbour = groupNeighbour(order.filter((id) => visible.has(id)), memberOf, groupId, step);
    if (neighbour) moveGroup(groupId, neighbour, step > 0);
  };
  const openInGroup = async (group: TabGroup) => {
    const before = new Set(useDocumentStore.getState().order);
    await pickAndOpen();
    const added = useDocumentStore.getState().order.filter((id) => !before.has(id));
    if (added.length === 0) return;
    const tabGroups = useTabGroupStore.getState();
    for (const id of added) tabGroups.join(id, group.id);
    tabGroups.setCollapsed(group.id, false);
    regroup();
  };
  const moveGroupToWindow = async (members: string[]) => {
    const blocked = members.find((id) => hasUnsavedWork(id) || (hasPending && id === activeDocumentId));
    if (blocked) {
      toast("info", t("viewer.window.saveFirst", { name: registered[blocked]?.fileName ?? "" }));
      return;
    }
    const paths = members.map((id) => registered[id]?.path).filter((path): path is string => !!path);
    if (await openWindow(paths)) for (const id of members) closeDocument(id);
  };
  const groupDragHandlers = (group: TabGroup) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setGroupDrag({ groupId: group.id, startX: event.clientX, moved: false, targetId: null, after: false, markX: 0 });
    },
    onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!groupDrag || groupDrag.groupId !== group.id) return;
      if (!groupDrag.moved && Math.abs(event.clientX - groupDrag.startX) < 5) return;
      const strip = stripRef.current;
      const over = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-tab-id]");
      if (!strip || !over || !strip.contains(over) || memberOf[over.dataset.tabId ?? ""] === group.id) {
        setGroupDrag({ ...groupDrag, moved: true, targetId: null });
        return;
      }
      const rect = over.getBoundingClientRect();
      const rtl = getComputedStyle(strip).direction === "rtl";
      const after = rtl ? event.clientX < rect.left + rect.width / 2 : event.clientX > rect.left + rect.width / 2;
      const edge = after !== rtl ? rect.right : rect.left;
      setGroupDrag({ ...groupDrag, moved: true, targetId: over.dataset.tabId ?? null, after, markX: edge - strip.getBoundingClientRect().left });
    },
    onPointerUp: () => {
      if (!groupDrag) return;
      if (groupDrag.moved) {
        skipChipClick.current = true;
        if (groupDrag.targetId) moveGroup(group.id, groupDrag.targetId, groupDrag.after);
      }
      setGroupDrag(null);
    },
    onPointerCancel: () => setGroupDrag(null),
  });

  const toggleGroup = (group: TabGroup) => {
    useTabGroupStore.getState().setCollapsed(group.id, !group.collapsed);
    if (group.collapsed || !activeDocumentId || memberOf[activeDocumentId] !== group.id) return;
    const outside = tabOutsideGroup(documents.map((doc) => doc.id), memberOf, group.id);
    if (outside) guardedActivate(outside);
  };

  const pageDropTarget = usePageDropTargetStore((state) => state.documentId);
  const chipped = new Set<string>();
  const tearOff = useTabTearOff((id) => void moveToWindow(id), { strip: () => stripRef.current, onReorder: reorderTo });

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
      <div ref={stripRef} role="tablist" aria-label={t("viewer.tabs")} className="relative flex items-stretch">
      {groupDrag?.targetId ? (
        <span aria-hidden className="pointer-events-none absolute inset-y-1 z-10 w-0.5 -translate-x-1/2 rounded-full bg-primary" style={{ left: groupDrag.markX }} />
      ) : null}
      {tearOff.dropMark ? (
        <span aria-hidden className="pointer-events-none absolute inset-y-1 z-10 w-0.5 -translate-x-1/2 rounded-full bg-primary" style={{ left: tearOff.dropMark.x }} />
      ) : null}
      {documents.map((doc) => {
        const active = doc.id === activeDocumentId;
        const label = registered[doc.id]?.fileName ?? doc.name;
        const group = groups.find((entry) => entry.id === memberOf[doc.id]);
        const tone = group ? GROUP_TONES[group.color] : undefined;
        const firstOfGroup = !!group && !chipped.has(group.id);
        if (group) chipped.add(group.id);
        const members = group ? documents.filter((entry) => memberOf[entry.id] === group.id).length : 0;
        const chip =
          group && firstOfGroup ? (
            renamingGroupId === group.id ? (
              <input
                key={`chip-${group.id}`}
                autoFocus
                defaultValue={group.name}
                maxLength={40}
                aria-label={t("viewer.tabGroups.name")}
                placeholder={t("viewer.tabGroups.name")}
                onBlur={(event) => {
                  useTabGroupStore.getState().rename(group.id, event.currentTarget.value);
                  setRenamingGroupId(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") setRenamingGroupId(null);
                }}
                className="my-1.5 ms-1 w-28 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ borderColor: tone }}
              />
            ) : (
              <button
                key={`chip-${group.id}`}
                type="button"
                data-tab-id={doc.id}
                aria-expanded={!group.collapsed}
                aria-keyshortcuts="Control+Shift+ArrowLeft Control+Shift+ArrowRight"
                title={t("viewer.tabGroups.toggle")}
                {...groupDragHandlers(group)}
                onClick={() => {
                  if (skipChipClick.current) {
                    skipChipClick.current = false;
                    return;
                  }
                  toggleGroup(group);
                }}
                onKeyDown={(event) => {
                  if (!event.ctrlKey || !event.shiftKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
                  event.preventDefault();
                  const forward = event.key === "ArrowRight" !== (getComputedStyle(event.currentTarget).direction === "rtl");
                  moveGroupBy(group.id, forward ? 1 : -1);
                  const chipButton = event.currentTarget;
                  requestAnimationFrame(() => chipButton.focus());
                }}
                onDoubleClick={() => setRenamingGroupId(group.id)}
                onContextMenu={(event) => {
                  setMenuGroupId(group.id);
                  groupMenu.open(event);
                }}
                className={cn(
                  "my-1.5 ms-1 flex max-w-36 touch-none select-none items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-background outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  groupDrag?.groupId === group.id && groupDrag.moved && "cursor-grabbing opacity-70",
                )}
                style={{ backgroundColor: tone }}
              >
                <span className="truncate">{group.name || t("viewer.tabGroups.unnamed")}</span>
                {group.collapsed ? <span className="tabular-nums opacity-80">{members}</span> : null}
              </button>
            )
          ) : null;
        if (group?.collapsed && !active) return <Fragment key={doc.id}>{chip}</Fragment>;
        return (
          <Fragment key={doc.id}>
          {chip}
          <div
            role="tab"
            data-tab-id={doc.id}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            aria-keyshortcuts="Delete Control+Shift+ArrowLeft Control+Shift+ArrowRight"
            onPointerDown={(event) => {
              if (event.target instanceof Element && event.target.closest("[data-tab-close]")) return;
              tearOff.onPointerDown(doc.id, event);
            }}
            onClick={() => {
              if (!tearOff.consumeDrag()) guardedActivate(doc.id);
            }}
            onKeyDown={(event) => {
              if (event.ctrlKey && event.shiftKey && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
                event.preventDefault();
                const index = documents.findIndex((entry) => entry.id === doc.id);
                const step = event.key === "ArrowRight" ? 1 : -1;
                reorderTo(doc.id, Math.min(documents.length - 1, Math.max(0, index + step)));
                const tab = event.currentTarget;
                requestAnimationFrame(() => tab.focus());
              } else if (event.key === "Enter" || event.key === " ") {
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
                const nextTab = tabs[nextIndex];
                nextTab?.focus();
                if (nextTab?.dataset.tabId) guardedActivate(nextTab.dataset.tabId);
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
              (tearOff.draggingId === doc.id || (group && groupDrag?.groupId === group.id && groupDrag.moved)) && "cursor-grabbing opacity-60",
              pageDropTarget === doc.id && "bg-primary/15 text-foreground",
            )}
          >
            {tone ? <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-0.5" style={{ backgroundColor: tone }} /> : null}
            <span className="min-w-0 flex-1 truncate" title={label}>
              {label}
            </span>
            <span
              aria-hidden
              data-tab-close=""
              title={`${t("common.close")}: ${label}`}
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
          </Fragment>
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
              { type: "separator", id: "sep-group" },
              { type: "item", id: "group-new", label: t("viewer.tabGroups.addToNew"), onSelect: () => groupWith(menuDocId, null) },
              ...(groups.some((group) => group.id !== memberOf[menuDocId])
                ? [
                    {
                      type: "submenu" as const,
                      id: "group-join",
                      label: t("viewer.tabGroups.addTo"),
                      items: groups
                        .filter((group) => group.id !== memberOf[menuDocId])
                        .map((group) => ({ type: "item" as const, id: `group-${group.id}`, label: group.name || t("viewer.tabGroups.unnamed"), onSelect: () => groupWith(menuDocId, group.id) })),
                    },
                  ]
                : []),
              ...(memberOf[menuDocId]
                ? [{ type: "item" as const, id: "group-leave", label: t("viewer.tabGroups.remove"), onSelect: () => useTabGroupStore.getState().leave(menuDocId) }]
                : []),
              { type: "separator", id: "sep-window" },
              { type: "item", id: "move-to-window", label: t("viewer.window.moveToNew"), onSelect: () => void moveToWindow(menuDocId) },
              ...(activeDocumentId && activeDocumentId !== menuDocId && registered[activeDocumentId]
                ? [{ type: "item" as const, id: "open-beside", label: t("viewer.split.openBeside"), onSelect: () => openBeside(activeDocumentId, menuDocId) }]
                : []),
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
      {groupMenu.anchor && menuGroupId
        ? (() => {
            const group = groups.find((entry) => entry.id === menuGroupId);
            if (!group) return null;
            const members = documents.filter((entry) => memberOf[entry.id] === group.id).map((entry) => entry.id);
            const store = useTabGroupStore.getState();
            const items: ContextMenuItem[] = [
              { type: "item", id: "rename", label: t("viewer.tabGroups.rename"), onSelect: () => setRenamingGroupId(group.id) },
              {
                type: "submenu",
                id: "color",
                label: t("viewer.tabGroups.color"),
                items: GROUP_COLORS.map((color) => ({ type: "item" as const, id: `color-${color}`, label: t(`viewer.tabGroups.colors.${color}`), swatch: GROUP_TONES[color], checked: group.color === color, onSelect: () => store.recolor(group.id, color) })),
              },
              { type: "item", id: "collapse", label: t(group.collapsed ? "viewer.tabGroups.expand" : "viewer.tabGroups.collapse"), onSelect: () => toggleGroup(group) },
              { type: "separator", id: "sep-group-docs" },
              { type: "item", id: "new-document", label: t("viewer.tabGroups.newDocument"), onSelect: () => void openInGroup(group) },
              { type: "item", id: "move-to-window", label: t("viewer.tabGroups.moveToWindow"), onSelect: () => void moveGroupToWindow(members) },
              { type: "separator", id: "sep-group-end" },
              {
                type: "item",
                id: "save-collection",
                label: t("viewer.tabGroups.saveAsCollection"),
                onSelect: () => {
                  const name = group.name || t("viewer.tabGroups.unnamed");
                  useCollectionsStore.getState().create(name, members.map((id) => sessionPathOf(registered[id]?.path ?? "")).filter(Boolean));
                  toast("success", t("home.collections.saved", { name }));
                },
              },
              { type: "item", id: "ungroup", label: t("viewer.tabGroups.ungroup"), onSelect: () => store.ungroup(group.id) },
              { type: "item", id: "close-group", label: t("viewer.tabGroups.close"), onSelect: () => guardedClose(members) },
            ];
            return <ContextMenu anchor={groupMenu.anchor} items={items} label={group.name || t("viewer.tabGroups.unnamed")} onClose={groupMenu.close} />;
          })()
        : null}
    </div>
  );
}
