import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { optionLabel, type FormValue } from "@/features/tools/forms/fillValues";
import { cn } from "@/shared/lib/cn";
import { useUiStore } from "@/shared/store/uiStore";
import { useViewerOverlayStore } from "@/shared/store/viewerOverlayStore";
import type { FormField } from "@/types";
import { frameSizePx, frameTransform } from "../overlay/pageFrame";
import { pageTurns, visiblePageSize } from "../overlay/pageSize";
import { useFormFillStore } from "./formFillStore";
import { useFormFields } from "./useFormFields";
import { widgetsOnPage, type PlacedWidget } from "./formWidgets";

type LayerProps = { documentId: string; pageIndex: number; width: number; height: number };

const STOPPED_EVENTS = ["pointerdown", "mousedown", "touchstart"] as const;
const TEXT_BASE = "pointer-events-auto absolute rounded-sm border-0 px-0.5 py-0 caret-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed";
const QUIET = "bg-transparent text-transparent hover:bg-primary/10 focus:bg-background focus:text-foreground";
const FILLED = "bg-background text-foreground";

function fieldName(field: FormField): string {
  return field.label || field.name;
}

export function FormFieldLayer({ documentId, pageIndex, width, height }: LayerProps) {
  const { t } = useTranslation();
  const load = useFormFields(documentId);
  const overlayMode = useViewerOverlayStore((state) => state.mode);
  const immersive = useUiStore((state) => state.immersive);
  const own = useFormFillStore((state) => state.values[documentId]);
  const setValue = useFormFillStore((state) => state.setValue);
  const layerRef = useRef<HTMLDivElement>(null);
  const fields = load?.state === "loaded" ? load.result.fields : null;
  const placed = useMemo(() => (fields ? widgetsOnPage(fields, pageIndex + 1) : []), [fields, pageIndex]);
  const hidden = overlayMode !== null || immersive || placed.length === 0;

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const stop = (event: Event) => event.stopPropagation();
    for (const type of STOPPED_EVENTS) layer.addEventListener(type, stop);
    return () => {
      for (const type of STOPPED_EVENTS) layer.removeEventListener(type, stop);
    };
  }, [hidden]);

  if (hidden || load?.state !== "loaded") return null;

  const page = visiblePageSize(documentId, pageIndex, width, height);
  const turns = pageTurns(documentId, pageIndex);
  const frame = frameSizePx(turns, width, height);
  const scale = frame.width / page.width;
  const label = t("viewer.formFill.label");
  const current = (name: string): FormValue | undefined => own?.[name] ?? load.initial[name];
  const isFilled = (name: string) => own?.[name] !== undefined;
  const change = (name: string, value: FormValue) => setValue(documentId, name, value, label);

  const box = (rect: number[]): CSSProperties => ({
    left: rect[0] * scale,
    top: rect[1] * scale,
    width: (rect[2] - rect[0]) * scale,
    height: (rect[3] - rect[1]) * scale,
  });

  const renderWidget = ({ key, field, rect, state }: PlacedWidget) => {
    const style = box(rect);
    const fontSize = Math.max(6, Math.min((rect[3] - rect[1]) * 0.7, 12) * scale);
    const filled = isFilled(field.name);
    const tone = filled ? FILLED : QUIET;
    const disabled = field.readOnly;
    const value = current(field.name);
    const common = { "data-form-field": field.name, disabled, "aria-required": field.required || undefined };

    if (field.kind === "checkbox" || field.kind === "radio") {
      const radio = field.kind === "radio";
      const checked = radio ? value === state : value === true;
      const optionName = radio && state ? optionLabel(field, state) : null;
      return (
        <span key={key} className={cn("pointer-events-auto absolute flex items-center justify-center rounded-sm", filled ? FILLED : "hover:bg-primary/10")} style={style}>
          <input
            {...common}
            type={radio ? "radio" : "checkbox"}
            name={radio ? `${documentId}:${field.name}` : undefined}
            value={state ?? undefined}
            checked={checked}
            aria-label={optionName ? t("viewer.formFill.option", { field: fieldName(field), option: optionName }) : fieldName(field)}
            className="absolute inset-0 m-0 size-full cursor-pointer appearance-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
            onChange={(event) => change(field.name, radio ? (event.currentTarget.checked && state ? state : "") : event.currentTarget.checked)}
          />
          {filled && checked ? radio ? <span aria-hidden className="pointer-events-none size-1/2 rounded-full bg-foreground" /> : <Check aria-hidden className="pointer-events-none size-full text-foreground" /> : null}
        </span>
      );
    }

    if (field.kind === "combobox" || field.kind === "listbox") {
      if (field.editable) {
        const listId = `${documentId}-${key}-options`;
        return (
          <span key={key}>
            <input {...common} type="text" list={listId} aria-label={fieldName(field)} className={cn(TEXT_BASE, tone)} style={{ ...style, fontSize }} value={typeof value === "string" ? value : ""} onChange={(event) => change(field.name, event.currentTarget.value)} />
            <datalist id={listId}>
              {field.options.map((option) => (
                <option key={option} value={option}>
                  {optionLabel(field, option)}
                </option>
              ))}
            </datalist>
          </span>
        );
      }
      const multiple = Boolean(field.multiSelect);
      const selected = multiple ? (Array.isArray(value) ? value : []) : typeof value === "string" ? value : "";
      return (
        <select
          {...common}
          key={key}
          multiple={multiple}
          aria-label={fieldName(field)}
          className={cn(TEXT_BASE, tone)}
          style={{ ...style, fontSize }}
          value={selected}
          onChange={(event) => change(field.name, multiple ? Array.from(event.currentTarget.selectedOptions, (option) => option.value) : event.currentTarget.value)}
        >
          {multiple ? null : <option value="">{t("tools.forms.noChoice")}</option>}
          {field.options.map((option) => (
            <option key={option} value={option}>
              {optionLabel(field, option)}
            </option>
          ))}
        </select>
      );
    }

    const text = typeof value === "string" ? value : "";
    const maxLength = field.maxLength ?? undefined;
    if (field.multiline) {
      return <textarea {...common} key={key} aria-label={fieldName(field)} maxLength={maxLength} className={cn(TEXT_BASE, "resize-none", tone)} style={{ ...style, fontSize }} value={text} onChange={(event) => change(field.name, event.currentTarget.value)} />;
    }
    return <input {...common} key={key} type="text" aria-label={fieldName(field)} maxLength={maxLength} className={cn(TEXT_BASE, tone)} style={{ ...style, fontSize }} value={text} onChange={(event) => change(field.name, event.currentTarget.value)} />;
  };

  return (
    <div
      ref={layerRef}
      data-form-fields=""
      role="group"
      aria-label={t("viewer.formFill.page", { page: pageIndex + 1 })}
      className="pointer-events-none absolute left-0 top-0 z-10"
      style={{ width: frame.width, height: frame.height, transform: frameTransform(turns, width, height), transformOrigin: "0 0" }}
    >
      {placed.map(renderWidget)}
    </div>
  );
}
