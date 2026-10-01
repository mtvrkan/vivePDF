import { useTranslation } from "react-i18next";
import { Checkbox, Field, Section, SelectInput, TextInput } from "@/components/tool/form";
import { OutputPathField } from "@/components/tool/OutputPathField";
import type { ConvertOptions } from "./useConvertOptions";

export function UrlToPdfSection({
  running,
  ready,
  run,
  output,
  setOutput,
  options,
}: {
  running: boolean;
  ready: boolean;
  run: () => void;
  output: string;
  setOutput: (value: string) => void;
  options: ConvertOptions;
}) {
  const { t } = useTranslation();
  const { url, setUrl, readerMode, setReaderMode, includeImages, setIncludeImages, paper, setPaper } = options;
  return (
    <>
      <Section title={t("tools.convert.address")}>
        <Field label={t("tools.convert.addressLabel")} hint={t("tools.convert.addressHint")}>
          <TextInput
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && ready && !running) run();
            }}
            placeholder="https://"
            spellCheck={false}
            disabled={running}
          />
        </Field>
        <Checkbox label={t("tools.convert.readerMode")} hint={t("tools.convert.readerModeHint")} checked={readerMode} onChange={setReaderMode} disabled={running} />
        <Checkbox label={t("tools.convert.includeImages")} checked={includeImages} onChange={setIncludeImages} disabled={running} />
        <Field label={t("tools.pages.paperSize")}>
          <SelectInput value={paper} onChange={(event) => setPaper(event.target.value as "a4" | "letter")} className="w-32" disabled={running}>
            <option value="a4">A4</option>
            <option value="letter">Letter</option>
          </SelectInput>
        </Field>
      </Section>
      <Section>
        <OutputPathField value={output} onChange={setOutput} disabled={running} />
      </Section>
    </>
  );
}
