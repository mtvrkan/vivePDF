import { Crop } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Segmented, SliderField } from "@/components/tool/form";
import type { StudioImageElement } from "@/types/studio";
import { patchSelected } from "./commands";
import { PanelSection } from "./controls";
import { beginCrop, croppable } from "./cropMode";
import { pickImage } from "./pickImage";

export function ImageSection({ element }: { element: StudioImageElement }) {
  const { t } = useTranslation();
  const set = (patch: Partial<StudioImageElement>, merge?: string) => patchSelected((item) => (item.kind === "image" ? patch : {}), merge);
  const crop = element.crop;
  const setCrop = (side: "left" | "top" | "right" | "bottom", percent: number) => {
    const value = percent / 100;
    const left = side === "left" ? value : crop.x;
    const top = side === "top" ? value : crop.y;
    const right = side === "right" ? value : 1 - crop.x - crop.width;
    const bottom = side === "bottom" ? value : 1 - crop.y - crop.height;
    if (left + right > 0.95 || top + bottom > 0.95) return;
    set({ crop: { x: left, y: top, width: 1 - left - right, height: 1 - top - bottom } }, `crop-${side}`);
  };
  return (
    <PanelSection title={t("studio.props.image")}>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="glass-chip h-8 rounded-lg px-3 text-sm font-medium"
          onClick={async () => {
            const src = await pickImage(t("studio.props.replaceImage"));
            if (src) set({ src });
          }}
        >
          {t("studio.props.replaceImage")}
        </button>
        <button type="button" data-testid="studio-crop-button" className="glass-chip inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium disabled:pointer-events-none disabled:opacity-40" disabled={!croppable(element)} aria-keyshortcuts="Enter" title={`${t("studio.crop.button")} (Enter)`} onClick={() => void beginCrop(element)}>
          <Crop className="size-4" aria-hidden />
          {t("studio.crop.button")}
        </button>
      </div>
      <Segmented size="sm" value={element.fit} options={["cover", "contain", "stretch"] as const} labelOf={(fit) => t(`studio.fit.${fit}`)} onChange={(fit) => set({ fit })} ariaLabel={t("studio.fit.label")} />
      <Segmented size="sm" value={element.mask} options={["none", "rounded", "circle"] as const} labelOf={(mask) => t(`studio.mask.${mask}`)} onChange={(mask) => set({ mask })} ariaLabel={t("studio.mask.label")} />
      <div className="grid grid-cols-2 gap-x-3">
        <SliderField label={t("studio.crop.left")} value={Math.round(crop.x * 100)} min={0} max={90} format={(value) => `${value}%`} onChange={(value) => setCrop("left", value)} />
        <SliderField label={t("studio.crop.right")} value={Math.round((1 - crop.x - crop.width) * 100)} min={0} max={90} format={(value) => `${value}%`} onChange={(value) => setCrop("right", value)} />
        <SliderField label={t("studio.crop.top")} value={Math.round(crop.y * 100)} min={0} max={90} format={(value) => `${value}%`} onChange={(value) => setCrop("top", value)} />
        <SliderField label={t("studio.crop.bottom")} value={Math.round((1 - crop.y - crop.height) * 100)} min={0} max={90} format={(value) => `${value}%`} onChange={(value) => setCrop("bottom", value)} />
      </div>
    </PanelSection>
  );
}
