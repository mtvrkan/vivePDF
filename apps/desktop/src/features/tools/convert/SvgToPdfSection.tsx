import { Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { Section, SwitchField } from "@/components/tool/form";
import { FileDropArea } from "@/components/tool/FileDropArea";
import { OutputDirField, OutputPathField } from "@/components/tool/OutputPathField";
import { basenameOf } from "@/shared/lib/paths";
import { svgWritesOneFile } from "./conversions";
import type { ConvertOptions } from "./useConvertOptions";

export function SvgToPdfSection({
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
  const { svgFiles, setSvgFiles, combineSvg, setCombineSvg, addSvgFiles } = options;
  return (
    <>
      <Section title={t("tools.convert.svgFiles")}>
        {svgFiles.length === 0 ? (
          <FileDropArea title={t("tools.dropZone.files")} description={t("tools.convert.dropSvg")} onPick={() => void addSvgFiles()} disabled={running} />
        ) : (
          <ul className="divide-y rounded-md border">
            {svgFiles.map((file) => (
              <li key={file} className="flex h-row items-center gap-2 px-2 text-sm">
                <span className="min-w-0 flex-1 truncate" title={file}>{basenameOf(file)}</span>
                <IconButton icon={X} label={t("common.removeNamed", { name: basenameOf(file) })} disabled={running} onClick={() => setSvgFiles((state) => state.filter((item) => item !== file))} />
              </li>
            ))}
          </ul>
        )}
        {svgFiles.length > 0 ? (
          <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => void addSvgFiles()} disabled={running}>{t("tools.convert.addFiles")}</Button>
        ) : null}
        {svgFiles.length > 1 ? <SwitchField label={t("tools.convert.combineSvg")} hint={t("tools.convert.combineSvgHint")} checked={combineSvg} onChange={setCombineSvg} disabled={running} /> : null}
        {tools && !tools.libreoffice ? <p className="text-xs text-warning">{t("tools.convert.svgNeedsLibreOffice")}</p> : null}
      </Section>
      <Section>
        {svgWritesOneFile(svgFiles.length, combineSvg) ? (
          <OutputPathField value={output} onChange={setOutput} disabled={running} />
        ) : (
          <OutputDirField value={outputDir} onChange={setOutputDir} disabled={running} />
        )}
      </Section>
    </>
  );
}
