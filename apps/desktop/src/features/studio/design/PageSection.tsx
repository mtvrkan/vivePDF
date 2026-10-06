import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Select } from "@/components/shared/Select";
import { Segmented, SliderField, TextInput } from "@/components/tool/form";
import type { StudioPage } from "@/types/studio";
import { MAX_PAGE_NAME, STUDIO_PAGE_SIZES, type StudioPageSize } from "../model/design";
import { resizeAllPages, resizePage, type PageResizeMode } from "../model/pages";
import { FillEditor, NumberField, PanelSection } from "./controls";
import { pickImage } from "./pickImage";
import { useStudioStore } from "./studioStore";
import { fromMm, toMm } from "./units";

function sizeKeyOf(page: StudioPage): StudioPageSize | "custom" {
  const match = (Object.keys(STUDIO_PAGE_SIZES) as StudioPageSize[]).find((key) => Math.abs(STUDIO_PAGE_SIZES[key].width - page.width) < 0.5 && Math.abs(STUDIO_PAGE_SIZES[key].height - page.height) < 0.5);
  return match ?? "custom";
}

const RESIZE_MODES: PageResizeMode[] = ["keep", "scale"];
const resizeChoice: { mode: PageResizeMode } = { mode: "keep" };

export function PageProperties({ page }: { page: StudioPage }) {
  const { t } = useTranslation();
  const applyToPage = useStudioStore((state) => state.applyToPage);
  const apply = useStudioStore((state) => state.apply);
  const sameSize = useStudioStore((state) => state.design?.pages.every((other) => other.width === page.width && other.height === page.height) ?? true);
  const [mode, setMode] = useState<PageResizeMode>(resizeChoice.mode);
  const setPage = (patch: Partial<StudioPage>, merge?: string) => applyToPage((current) => ({ ...current, ...patch }), merge ? { merge } : undefined);
  const resize = (width: number, height: number) => applyToPage((current) => resizePage(current, width, height, mode));
  const sizeKey = sizeKeyOf(page);
  const image = page.background.image;
  return (
    <>
      <PanelSection title={t("studio.page.title")}>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">{t("studio.page.name")}</span>
          <TextInput
            value={page.name}
            maxLength={MAX_PAGE_NAME}
            placeholder={t("studio.page.namePlaceholder")}
            onChange={(event) => setPage({ name: event.target.value.slice(0, MAX_PAGE_NAME) }, "page-name")}
            onBlur={(event) => {
              const name = event.target.value.trim();
              if (name !== page.name) setPage({ name }, "page-name");
            }}
            className="h-8 text-sm"
          />
        </label>
      </PanelSection>
      <PanelSection title={t("studio.page.size")}>
        <Select
          value={sizeKey}
          ariaLabel={t("studio.page.size")}
          options={[...Object.keys(STUDIO_PAGE_SIZES).map((key) => ({ value: key, label: t(`studio.sizes.${key}`) })), { value: "custom", label: t("studio.sizes.custom"), disabled: true }]}
          onChange={(key) => {
            const size = STUDIO_PAGE_SIZES[key as StudioPageSize];
            if (size) resize(size.width, size.height);
          }}
        />
        <div className="grid grid-cols-2 gap-2">
          <NumberField label={t("studio.page.width")} suffix="mm" value={toMm(page.width)} min={6.4} max={5080} step={1} onChange={(value) => resize(fromMm(value), page.height)} />
          <NumberField label={t("studio.page.height")} suffix="mm" value={toMm(page.height)} min={6.4} max={5080} step={1} onChange={(value) => resize(page.width, fromMm(value))} />
        </div>
        <div className="space-y-1">
          <span className="block text-xs font-medium text-muted-foreground">{t("studio.page.resizeContent")}</span>
          <Segmented
            size="sm"
            value={mode}
            options={RESIZE_MODES}
            labelOf={(value) => t(`studio.page.resize.${value}`)}
            onChange={(value) => {
              resizeChoice.mode = value;
              setMode(value);
            }}
            ariaLabel={t("studio.page.resizeContent")}
          />
        </div>
        <button
          type="button"
          className="glass-chip h-8 w-full rounded-lg px-3 text-sm font-medium disabled:opacity-50"
          disabled={sameSize}
          onClick={() => apply((design) => resizeAllPages(design, page.width, page.height, mode))}
        >
          {t("studio.page.applyToAll")}
        </button>
      </PanelSection>
      <PanelSection title={t("studio.page.background")}>
        <FillEditor value={page.background.fill} onChange={(fill, merge) => setPage({ background: { ...page.background, fill } }, merge)} />
        {page.background.fill.type === "none" ? (
          <p className="text-xs text-muted-foreground" data-testid="studio-page-see-through">
            {t("studio.page.noBackgroundHint")}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="glass-chip h-8 rounded-lg px-3 text-sm font-medium"
            onClick={async () => {
              const src = await pickImage(t("studio.page.backgroundImage"));
              if (src) setPage({ background: { ...page.background, image: { src, fit: "cover", opacity: 1 } } });
            }}
          >
            {image ? t("studio.page.replaceImage") : t("studio.page.backgroundImage")}
          </button>
          {image ? (
            <button type="button" className="h-8 rounded-lg px-3 text-sm text-muted-foreground hover:text-foreground" onClick={() => setPage({ background: { ...page.background, image: null } })}>
              {t("studio.page.removeImage")}
            </button>
          ) : null}
        </div>
        {image ? (
          <SliderField label={t("studio.props.opacity")} value={Math.round(image.opacity * 100)} min={0} max={100} format={(value) => `${value}%`} onChange={(value) => setPage({ background: { ...page.background, image: { ...image, opacity: value / 100 } } }, "bg-opacity")} />
        ) : null}
      </PanelSection>
    </>
  );
}
