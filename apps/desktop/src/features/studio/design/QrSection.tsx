import { useTranslation } from "react-i18next";
import { Segmented, SwitchField, TextArea, TextInput } from "@/components/tool/form";
import type { StudioQrElement } from "@/types/studio";
import { buildVCard, EMPTY_VCARD, isVCard, parseVCard, VCARD_FIELDS, type VCard, type VCardField } from "../model/vcard";
import { patchSelected } from "./commands";
import { ColorField, PanelSection } from "./controls";

const CONTENTS = ["text", "contact"] as const;
const WIDE_FIELDS: ReadonlySet<VCardField> = new Set(["organization", "title", "email", "website", "address"]);
const INPUT_TYPES: Partial<Record<VCardField, string>> = { phone: "tel", mobile: "tel", email: "email", website: "url" };

type Content = (typeof CONTENTS)[number];

function ContactFields({ card, onChange }: { card: VCard; onChange: (field: VCardField, value: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-2" data-testid="studio-qr-contact">
      {VCARD_FIELDS.map((field) => (
        <label key={field} className={WIDE_FIELDS.has(field) ? "col-span-2 block" : "block"}>
          <span className="mb-1 block text-xs font-medium text-muted-foreground">{t(`studio.props.vcard.${field}`)}</span>
          <TextInput type={INPUT_TYPES[field] ?? "text"} value={card[field]} maxLength={200} onChange={(event) => onChange(field, event.target.value)} className="text-sm" />
        </label>
      ))}
    </div>
  );
}

export function QrSection({ element }: { element: StudioQrElement }) {
  const { t } = useTranslation();
  const set = (patch: Partial<StudioQrElement>, merge?: string) => patchSelected((item) => (item.kind === "qr" ? patch : {}), merge);
  const card = parseVCard(element.value);
  const content: Content = isVCard(element.value) ? "contact" : "text";
  const switchContent = (next: Content) => {
    if (next === content) return;
    const link = /^https?:\/\/\S+$/i.test(element.value.trim()) ? element.value.trim() : "";
    set({ value: next === "contact" ? buildVCard({ ...EMPTY_VCARD, website: link }) : (card?.website ?? "") });
  };
  return (
    <PanelSection title={t("studio.props.qr")}>
      <Segmented size="sm" value={content} options={CONTENTS} labelOf={(value) => t(`studio.props.qrContents.${value}`)} onChange={switchContent} ariaLabel={t("studio.props.qrContent")} />
      {card ? (
        <ContactFields card={card} onChange={(field, value) => set({ value: buildVCard({ ...card, [field]: value }) }, `qr-vcard-${field}`)} />
      ) : (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">{t("studio.props.qrValue")}</span>
          <TextArea rows={3} value={element.value} maxLength={2000} onChange={(event) => set({ value: event.target.value }, "qr-value")} />
        </label>
      )}
      <ColorField label={t("studio.props.color")} value={element.color} onChange={(color) => set({ color })} />
      <SwitchField label={t("studio.props.qrBackground")} checked={element.background !== null} onChange={(on) => set({ background: on ? "#ffffff" : null })} />
      {element.background ? <ColorField label={t("studio.props.background")} value={element.background} onChange={(background) => set({ background })} /> : null}
      <Segmented size="sm" value={element.errorLevel} options={["L", "M", "Q", "H"] as const} labelOf={(level) => level} onChange={(errorLevel) => set({ errorLevel })} ariaLabel={t("studio.props.qrLevel")} />
    </PanelSection>
  );
}
