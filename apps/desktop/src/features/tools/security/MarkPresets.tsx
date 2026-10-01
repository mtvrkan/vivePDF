import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { PresetRow, TextInput } from "@/components/tool/form";
import type { MarkPreset } from "@/features/tools/security/markPresetStore";

export function MarkPresets({ items, name, onName, onApply, onDrop, onSave }: {
  items: MarkPreset[];
  name: string;
  onName: (value: string) => void;
  onApply: (item: MarkPreset) => void;
  onDrop: (name: string) => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      <PresetRow label={t("tools.security.presets.title")}>
        {items.length === 0 ? <span className="text-xs text-muted-foreground">{t("tools.security.presets.empty")}</span> : null}
        {items.map((item) => (
          <span key={item.name} className="flex h-7 items-center gap-1 rounded-md border bg-secondary ps-2.5 pe-1 text-sm">
            <button type="button" className="outline-none hover:underline focus-visible:underline" onClick={() => onApply(item)}>{item.name}</button>
            <IconButton icon={X} label={t("common.delete")} onClick={() => onDrop(item.name)} />
          </span>
        ))}
      </PresetRow>
      <div className="flex items-center gap-2">
        <TextInput value={name} onChange={(event) => onName(event.target.value)} placeholder={t("tools.security.presets.placeholder")} className="max-w-64" maxLength={40} />
        <Button size="sm" onClick={onSave} disabled={!name.trim()}>{t("tools.security.presets.save")}</Button>
      </div>
    </div>
  );
}
