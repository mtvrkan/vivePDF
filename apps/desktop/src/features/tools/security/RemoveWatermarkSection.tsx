import { useTranslation } from "react-i18next";
import { Field, Section, SwitchField, TextInput } from "@/components/tool/form";
import { WatermarkFinder } from "@/features/tools/security/WatermarkFinder";
import type { RpcError, WatermarkCandidate } from "@/types";

export function RemoveWatermarkSection({
  found,
  chosen,
  finding,
  findError,
  pagesScanned,
  onRescan,
  onToggle,
  scanned,
  removeText,
  onRemoveText,
  removeAnnotations,
  onRemoveAnnotations,
  removeImages,
  onRemoveImages,
  removePages,
  onRemovePages,
}: {
  found: WatermarkCandidate[] | null;
  chosen: Record<string, boolean>;
  finding: boolean;
  findError: RpcError | null;
  pagesScanned: number;
  onRescan: () => void;
  onToggle: (id: string, value: boolean) => void;
  scanned: boolean;
  removeText: string;
  onRemoveText: (value: string) => void;
  removeAnnotations: boolean;
  onRemoveAnnotations: (value: boolean) => void;
  removeImages: boolean;
  onRemoveImages: (value: boolean) => void;
  removePages: string;
  onRemovePages: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Section title={t("tools.security.removeWatermark.title")}>
      <p className="text-sm text-muted-foreground">{t("tools.security.removeWatermark.hint")}</p>
      <WatermarkFinder candidates={found} chosen={chosen} scanning={finding} error={findError} pagesScanned={pagesScanned} onRescan={onRescan} onToggle={onToggle} />
      <Field label={t("tools.security.removeWatermark.finder.manual")} hint={t("tools.security.removeWatermark.finder.manualHint")}>
        <TextInput value={removeText} onChange={(event) => onRemoveText(event.target.value)} />
      </Field>
      <SwitchField label={t("tools.security.removeWatermark.annotations")} hint={t("tools.security.removeWatermark.annotationsHint")} checked={removeAnnotations} onChange={onRemoveAnnotations} disabled={scanned} />
      <SwitchField label={t("tools.security.removeWatermark.repeatedImages")} hint={t("tools.security.removeWatermark.repeatedImagesHint")} checked={removeImages} onChange={onRemoveImages} disabled={scanned} />
      <Field label={t("tools.security.removeWatermark.pages")} hint={t("tools.split.rangesHint")}>
        <TextInput value={removePages} onChange={(event) => onRemovePages(event.target.value)} placeholder={t("tools.allPages")} className="font-mono" />
      </Field>
    </Section>
  );
}
