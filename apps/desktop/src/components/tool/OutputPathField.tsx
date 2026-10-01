import { FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/shared/Button";
import { basenameOf, dirnameOf } from "@/shared/lib/paths";
import { Field, TextInput } from "./form";

type OutputPathFieldProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  extension?: string;
};

export function OutputPathField({ value, onChange, disabled, label, extension = "pdf" }: OutputPathFieldProps) {
  const { t } = useTranslation();

  const browse = async () => {
    const selected = await saveDialog({
      defaultPath: value || undefined,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    if (selected) onChange(selected.toLowerCase().endsWith(`.${extension}`) ? selected : `${selected}.${extension}`);
  };

  return (
    <Field label={label ?? t("tools.output")} hint={value ? `${t("tools.folder")}: ${dirnameOf(value)}` : undefined}>
      <div className="flex gap-2">
        <TextInput value={basenameOf(value)} readOnly disabled={disabled} className="font-mono text-sm" aria-label={t("tools.output")} />
        <Button icon={<FolderOpen className="size-4" aria-hidden />} onClick={() => void browse()} disabled={disabled}>
          {t("tools.browse")}
        </Button>
      </div>
    </Field>
  );
}

export function OutputDirField({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const { t } = useTranslation();

  const browse = async () => {
    const selected = await openDialog({ directory: true, multiple: false, defaultPath: value || undefined });
    if (typeof selected === "string") onChange(selected);
  };

  return (
    <Field label={t("tools.outputDir")}>
      <div className="flex gap-2">
        <TextInput value={value} readOnly disabled={disabled} className="font-mono text-sm" aria-label={t("tools.outputDir")} />
        <Button icon={<FolderOpen className="size-4" aria-hidden />} onClick={() => void browse()} disabled={disabled}>
          {t("tools.browse")}
        </Button>
      </div>
    </Field>
  );
}
