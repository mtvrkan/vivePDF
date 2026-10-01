import { Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { Field, Section, SelectInput } from "@/components/tool/form";
import { FileDropArea } from "@/components/tool/FileDropArea";
import { OutputDirField, OutputPathField } from "@/components/tool/OutputPathField";
import { basenameOf, extensionOf } from "@/shared/lib/paths";
import { OFFICE_LIKE_EXTENSIONS } from "./conversions";
import type { ConvertOptions } from "./useConvertOptions";

export function FileToPdfSection({
  running,
  tools,
  output,
  setOutput,
  outputDir,
  setOutputDir,
  options,
}: {
  running: boolean;
  tools: { libreoffice: string | null } | null;
  output: string;
  setOutput: (value: string) => void;
  outputDir: string;
  setOutputDir: (value: string) => void;
  options: ConvertOptions;
}) {
  const { t } = useTranslation();
  const { files, setFiles, paper, setPaper, addFiles } = options;
  return (
    <>
      <Section title={t("tools.convert.files")}>
        {files.length === 0 ? (
          <FileDropArea title={t("tools.dropZone.files")} description={t("tools.convert.dropFiles")} onPick={() => void addFiles()} disabled={running} />
        ) : (
          <ul className="divide-y rounded-md border">
            {files.map((file) => (
              <li key={file} className="flex h-row items-center gap-2 px-2 text-sm">
                <span className="w-10 font-mono text-xs uppercase text-muted-foreground">{extensionOf(file)}</span>
                <span className="min-w-0 flex-1 truncate" title={file}>{basenameOf(file)}</span>
                {OFFICE_LIKE_EXTENSIONS.includes(extensionOf(file)) && tools && !tools.libreoffice ? <span className="text-xs text-warning">{t("tools.convert.needsLibreOffice")}</span> : null}
                <IconButton icon={X} label={t("common.removeNamed", { name: basenameOf(file) })} disabled={running} onClick={() => setFiles((state) => state.filter((item) => item !== file))} />
              </li>
            ))}
          </ul>
        )}
        {files.length > 0 ? (
          <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => void addFiles()} disabled={running}>{t("tools.convert.addFiles")}</Button>
        ) : null}
        <Field label={t("tools.pages.paperSize")} hint={t("tools.convert.paperHint")}>
          <SelectInput value={paper} onChange={(event) => setPaper(event.target.value as "a4" | "letter")} className="w-32" disabled={running}>
            <option value="a4">A4</option>
            <option value="letter">Letter</option>
          </SelectInput>
        </Field>
      </Section>
      <Section>
        {files.length > 1 ? (
          <OutputDirField value={outputDir} onChange={setOutputDir} disabled={running} />
        ) : (
          <OutputPathField value={output} onChange={setOutput} disabled={running} />
        )}
      </Section>
    </>
  );
}
