import { useTranslation } from "react-i18next";
import { Segmented, SwitchField, TextArea } from "@/components/tool/form";
import type { StudioQrElement } from "@/types/studio";
import { patchSelected } from "./commands";
import { ColorField, PanelSection } from "./controls";

export function QrSection({ element }: { element: StudioQrElement }) {
  const { t } = useTranslation();
  const set = (patch: Partial<StudioQrElement>, merge?: string) => patchSelected((item) => (item.kind === "qr" ? patch : {}), merge);
  return (
    <PanelSection title={t("studio.props.qr")}>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">{t("studio.props.qrValue")}</span>
        <TextArea rows={3} value={element.value} maxLength={2000} onChange={(event) => set({ value: event.target.value }, "qr-value")} />
      </label>
      <ColorField label={t("studio.props.color")} value={element.color} onChange={(color) => set({ color })} />
      <SwitchField label={t("studio.props.qrBackground")} checked={element.background !== null} onChange={(on) => set({ background: on ? "#ffffff" : null })} />
      {element.background ? <ColorField label={t("studio.props.background")} value={element.background} onChange={(background) => set({ background })} /> : null}
      <Segmented size="sm" value={element.errorLevel} options={["L", "M", "Q", "H"] as const} labelOf={(level) => level} onChange={(errorLevel) => set({ errorLevel })} ariaLabel={t("studio.props.qrLevel")} />
    </PanelSection>
  );
}
