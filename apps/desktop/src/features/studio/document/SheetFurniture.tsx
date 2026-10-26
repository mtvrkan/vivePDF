import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import type { DocumentAlign, DocumentSettings } from "@/types/studio";
import { FURNITURE_HEIGHT, FURNITURE_PT, furnitureOffset, numberAlign, numberLabel } from "./furniture";
import { useFurnitureEditing, type FurniturePart } from "./furnitureEditing";
import { useDocumentStore } from "./documentStore";

const JUSTIFY: Record<DocumentAlign, string> = { left: "justify-start", center: "justify-center", right: "justify-end" };
const TEXT_LIMIT = 200;

type Insets = { top: number; right: number; bottom: number; left: number };
type SheetFurnitureProps = { settings: DocumentSettings; inset: Insets; page: number; label: string; last: string; onLeave: () => void };

function FurnitureInput({ part, value, align, placeholder, label, onLeave, fit = false, inputRef }: { part: FurniturePart; value: string; align: DocumentAlign; placeholder: string; label: string; onLeave: () => void; fit?: boolean; inputRef: React.RefObject<HTMLInputElement | null> }) {
  const edit = useFurnitureEditing((state) => state.edit);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape" && event.key !== "Enter") return;
    event.preventDefault();
    useFurnitureEditing.getState().stop();
    onLeave();
  };
  const input = (
    <input
      ref={inputRef}
      value={value}
      maxLength={TEXT_LIMIT}
      placeholder={placeholder}
      aria-label={label}
      data-testid={`sheet-${part}`}
      onFocus={() => edit(part)}
      onKeyDown={onKeyDown}
      onChange={(event) => useDocumentStore.getState().setSettings({ [part]: event.target.value })}
      style={{ textAlign: fit ? undefined : align }}
      className={cn(
        "min-w-0 rounded-sm bg-transparent px-0.5 text-muted-foreground outline-none placeholder:text-transparent focus:placeholder:text-muted-foreground/70 group-hover:placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-primary/60",
        fit ? "col-start-1 row-start-1 w-full" : "h-full w-full",
      )}
    />
  );
  if (!fit) return input;
  return (
    <span className="inline-grid min-w-0 max-w-full">
      <span aria-hidden className="invisible col-start-1 row-start-1 whitespace-pre px-0.5">
        {value || placeholder}
      </span>
      {input}
    </span>
  );
}

function Band({ part, style, editing, tag, children }: { part: FurniturePart; style: CSSProperties; editing: boolean; tag: string; children: React.ReactNode }) {
  return (
    <div
      role="group"
      aria-label={tag}
      data-testid={`sheet-${part}-band`}
      data-editing={editing || undefined}
      className={cn("group absolute flex items-center rounded-sm", editing && "outline-dashed outline-1 outline-offset-2 outline-primary/60")}
      style={{ ...style, height: `${FURNITURE_HEIGHT}pt`, fontSize: `${FURNITURE_PT}pt`, lineHeight: 1 }}
    >
      {children}
      {editing ? <span className={cn("pointer-events-none absolute left-0 whitespace-nowrap rounded-sm bg-primary/10 px-1 text-primary", part === "header" ? "top-full mt-1" : "bottom-full mb-1")}>{tag}</span> : null}
    </div>
  );
}

export function SheetFurniture({ settings, inset, page, label, last, onLeave }: SheetFurnitureProps) {
  const { t } = useTranslation();
  const editing = useFurnitureEditing((state) => state.editing);
  const request = useFurnitureEditing((state) => state.request);
  const header = useRef<HTMLInputElement>(null);
  const footer = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!request) return;
    (request.part === "header" ? header : footer).current?.focus();
  }, [request]);

  const sides = { left: `${inset.left}pt`, right: `${inset.right}pt` };
  const numbers = numberAlign(settings.pageNumbers, page);
  const chip = numbers ? (
    <button
      type="button"
      title={t("studio.doc.furniture.pageNumber")}
      onClick={() => useFurnitureEditing.getState().open("footer")}
      className="shrink-0 rounded-sm bg-muted px-1 text-muted-foreground hover:text-foreground"
      data-testid="sheet-page-number"
    >
      {numberLabel(settings.pageNumberFormat, label, last)}
    </button>
  ) : null;
  const tagOf = (part: FurniturePart) => {
    const name = t(`studio.doc.ribbon.${part}`);
    return settings.furnitureOnFirst ? name : t("studio.doc.furniture.notOnFirst", { name });
  };
  const footerInput = (fit: boolean) => (
    <FurnitureInput part="footer" value={settings.footer} align={settings.footerAlign} placeholder={t("studio.doc.ribbon.footer")} label={t("studio.doc.settings.footer")} onLeave={onLeave} fit={fit} inputRef={footer} />
  );

  return (
    <>
      <Band part="header" editing={editing === "header"} tag={tagOf("header")} style={{ ...sides, top: `${furnitureOffset(inset.top)}pt` }}>
        <FurnitureInput part="header" value={settings.header} align={settings.headerAlign} placeholder={t("studio.doc.ribbon.header")} label={t("studio.doc.settings.header")} onLeave={onLeave} inputRef={header} />
      </Band>
      <Band part="footer" editing={editing === "footer"} tag={tagOf("footer")} style={{ ...sides, bottom: `${furnitureOffset(inset.bottom)}pt` }}>
        {numbers === settings.footerAlign ? (
          <div className={cn("flex h-full w-full min-w-0 items-center gap-1", JUSTIFY[settings.footerAlign])}>
            {footerInput(true)}
            {settings.footer.trim() ? <span aria-hidden className="text-muted-foreground">·</span> : null}
            {chip}
          </div>
        ) : (
          <>
            {footerInput(false)}
            {chip ? <div className={cn("pointer-events-none absolute inset-0 flex items-center", JUSTIFY[numbers ?? "center"])}><span className="pointer-events-auto">{chip}</span></div> : null}
          </>
        )}
      </Band>
    </>
  );
}
