import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Eye, EyeOff, Group, Lock, LockOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { cn } from "@/shared/lib/cn";
import type { StudioElement, StudioPage } from "@/types/studio";
import { updateElement, withoutGroupOf } from "../model/edit";
import { placeElements, reorderElements, type ReorderDirection } from "../model/layers";
import { useDragSort } from "./dragSort";
import { elementLabel, kindIcon } from "./labels";
import { canShift, layerRows, layerSource, resolveLayerDrop, type ElementRow, type GroupRow, type LayerDrop, type LayerRow, type LayerSource } from "./layerRows";
import { currentPage, useStudioStore } from "./studioStore";

const ROW_ATTRIBUTE = "data-layer-row";

function reveal(always: boolean) {
  return always ? undefined : "invisible group-hover/row:visible group-focus-within/row:visible";
}

function DropLine({ side }: { side: LayerDrop["side"] }) {
  return <span aria-hidden className={cn("pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-primary", side === "before" ? "-top-px" : "-bottom-px")} />;
}

function setFlag(page: StudioPage, ids: string[], key: "hidden" | "locked", value: boolean): StudioPage {
  return ids.reduce((current, id) => updateElement<StudioElement>(current, id, { [key]: value }), page);
}

export function LayersTab() {
  const { t } = useTranslation();
  const page = useStudioStore((state) => currentPage(state));
  const selection = useStudioStore((state) => state.selection);
  const groupScope = useStudioStore((state) => state.groupScope);
  const applyToPage = useStudioStore((state) => state.applyToPage);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const listRef = useRef<HTMLUListElement>(null);
  const focusKey = useRef<string | null>(null);

  const rows = useMemo(() => (page ? layerRows(page, (groupId) => toggled[groupId] ?? groupScope === groupId) : []), [page, toggled, groupScope]);

  const { drag, bind } = useDragSort<LayerSource, LayerDrop>({
    attribute: ROW_ATTRIBUTE,
    axis: "y",
    container: listRef,
    resolve: (source, probe) => {
      const current = currentPage(useStudioStore.getState());
      return current ? resolveLayerDrop(current, rows, source, probe) : null;
    },
    drop: (source, target) => applyToPage((current) => placeElements(current, source.ids, target.index)),
  });

  useEffect(() => {
    const key = focusKey.current;
    if (!key) return;
    focusKey.current = null;
    listRef.current?.querySelector<HTMLElement>(`[${ROW_ATTRIBUTE}="${CSS.escape(key)}"] [data-layer-main]`)?.focus();
  });

  if (!page) return null;
  if (!page.elements.length) return <p className="p-4 text-sm text-muted-foreground">{t("studio.layers.empty")}</p>;

  const chosen = new Set(selection);
  const dragged = new Set(drag?.source.ids ?? []);
  const reorder = (row: LayerRow, direction: ReorderDirection) => applyToPage((current) => reorderElements(current, layerSource(row).ids, direction));
  const canMove = (row: LayerRow, direction: "forward" | "backward") => canShift(row, page.elements.length, direction);

  const onRowKey = (row: LayerRow) => (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!event.altKey || event.ctrlKey || event.metaKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    event.stopPropagation();
    const up = event.key === "ArrowUp";
    focusKey.current = row.key;
    reorder(row, event.shiftKey ? (up ? "front" : "back") : up ? "forward" : "backward");
  };

  const toggleOpen = (row: GroupRow) => setToggled((current) => ({ ...current, [row.groupId]: !row.open }));

  const pickGroup = (row: GroupRow, event: ReactMouseEvent) => {
    const store = useStudioStore.getState();
    const ids = row.elements.map((element) => element.id);
    const whole = ids.every((id) => chosen.has(id));
    if (!event.shiftKey) return store.select(ids);
    store.select(whole ? withoutGroupOf(page, selection, ids[0]) : [...selection, ...ids]);
  };

  const pickElement = (row: ElementRow, event: ReactMouseEvent) => {
    const store = useStudioStore.getState();
    const id = row.element.id;
    const active = chosen.has(id);
    if (!row.member) return store.select(event.shiftKey ? (active ? withoutGroupOf(page, selection, id) : [...selection, id]) : [id]);
    if (!event.shiftKey) return store.enterGroup(id);
    if (groupScope === row.groupId && selection.length) return store.select(active ? selection.filter((other) => other !== id) : [...selection, id]);
    store.select(active ? withoutGroupOf(page, selection, id) : [...selection, id]);
  };

  const actions = (row: LayerRow, label: string, members: StudioElement[], active: boolean) => {
    const ids = members.map((element) => element.id);
    const hidden = members.every((element) => element.hidden);
    const locked = members.every((element) => element.locked);
    return (
      <>
        <span className={cn("flex shrink-0 items-center", reveal(active))}>
          <IconButton icon={ArrowUp} className="size-7" label={t("studio.layers.forward", { name: label })} shortcut="Alt+↑" disabled={!canMove(row, "forward")} onClick={() => reorder(row, "forward")} />
          <IconButton icon={ArrowDown} className="size-7" label={t("studio.layers.backward", { name: label })} shortcut="Alt+↓" disabled={!canMove(row, "backward")} onClick={() => reorder(row, "backward")} />
        </span>
        <IconButton
          icon={hidden ? EyeOff : Eye}
          className={cn("size-7", reveal(active || hidden))}
          label={hidden ? t("studio.layers.show", { name: label }) : t("studio.layers.hide", { name: label })}
          onClick={() => applyToPage((current) => setFlag(current, ids, "hidden", !hidden))}
        />
        <IconButton
          icon={locked ? Lock : LockOpen}
          active={locked}
          className={cn("size-7", reveal(active || locked))}
          label={locked ? t("studio.layers.unlock", { name: label }) : t("studio.layers.lock", { name: label })}
          onClick={() => applyToPage((current) => setFlag(current, ids, "locked", !locked))}
        />
      </>
    );
  };

  const target = drag?.target ?? null;

  return (
    <div className="space-y-2 p-2">
      <ul ref={listRef} className="space-y-0.5 select-none" aria-label={t("studio.layers.label")} aria-describedby="studio-layers-hint">
        {rows.map((row) => {
          const line = target?.key === row.key ? <DropLine side={target.side} /> : null;
          if (row.kind === "group") {
            const ids = row.elements.map((element) => element.id);
            const whole = ids.every((id) => chosen.has(id));
            const label = t("studio.layers.group", { count: row.elements.length });
            return (
              <li
                key={row.key}
                {...{ [ROW_ATTRIBUTE]: row.key }}
                {...bind(layerSource(row))}
                className={cn("group/row relative flex items-center gap-0.5 rounded-lg pl-0.5", whole ? "glass-chip" : "hover:bg-muted/50", ids.some((id) => dragged.has(id)) && "opacity-50")}
              >
                {line}
                <button
                  type="button"
                  aria-expanded={row.open}
                  aria-label={row.open ? t("studio.layers.collapse", { name: label }) : t("studio.layers.expand", { name: label })}
                  title={row.open ? t("studio.layers.collapse", { name: label }) : t("studio.layers.expand", { name: label })}
                  onClick={() => toggleOpen(row)}
                  className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {row.open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5 rtl:-scale-x-100" aria-hidden />}
                </button>
                <Group className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <button
                  type="button"
                  data-layer-main
                  aria-pressed={whole}
                  onClick={(event) => pickGroup(row, event)}
                  onDoubleClick={() => {
                    setToggled((current) => ({ ...current, [row.groupId]: true }));
                    useStudioStore.getState().enterGroup(ids[ids.length - 1]);
                  }}
                  onKeyDown={onRowKey(row)}
                  className="min-w-0 flex-1 truncate rounded py-1.5 pl-1 text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {label}
                </button>
                {actions(row, label, row.elements, whole)}
              </li>
            );
          }
          const element = row.element;
          const active = chosen.has(element.id) && (!row.member || groupScope === row.groupId);
          const inSelectedGroup = row.member && chosen.has(element.id) && !active;
          const label = elementLabel(element, t);
          const Icon = kindIcon(element);
          return (
            <li
              key={row.key}
              {...{ [ROW_ATTRIBUTE]: row.key }}
              {...(renaming === element.id ? {} : bind(layerSource(row)))}
              className={cn(
                "group/row relative flex items-center gap-1 rounded-lg",
                row.member ? "ml-5 pl-1.5" : "pl-2",
                active ? "glass-chip" : inSelectedGroup ? "bg-muted/60" : "hover:bg-muted/50",
                dragged.has(element.id) && "opacity-50",
              )}
            >
              {line}
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              {renaming === element.id ? (
                <input
                  autoFocus
                  defaultValue={element.name}
                  aria-label={t("studio.layers.rename")}
                  className="field h-7 min-w-0 flex-1 rounded px-2 text-sm"
                  onBlur={(event) => {
                    const name = event.target.value.trim().slice(0, 200);
                    applyToPage((current) => updateElement(current, element.id, { name }));
                    setRenaming(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") setRenaming(null);
                    event.stopPropagation();
                  }}
                />
              ) : (
                <button
                  type="button"
                  data-layer-main
                  aria-pressed={active}
                  onClick={(event) => pickElement(row, event)}
                  onDoubleClick={() => setRenaming(element.id)}
                  onKeyDown={onRowKey(row)}
                  className={cn("min-w-0 flex-1 truncate rounded py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring", element.hidden && "text-muted-foreground line-through")}
                >
                  {label}
                </button>
              )}
              {actions(row, label, [element], active)}
            </li>
          );
        })}
      </ul>
      <p id="studio-layers-hint" className="px-2 text-xs text-muted-foreground">
        {t("studio.layers.hint")}
      </p>
    </div>
  );
}
