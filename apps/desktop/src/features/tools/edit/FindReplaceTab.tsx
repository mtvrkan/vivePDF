import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Checkbox, Field, Section, TextInput } from "@/components/tool/form";
import type { SourceDocument } from "@/types";
import type { FindReplaceState } from "./useFindReplaceState";

export function FindReplaceTab({ state, source, pages, onPagesChange: setPages }: { state: FindReplaceState; source: SourceDocument | null; pages: string; onPagesChange: (value: string) => void }) {
  const { t } = useTranslation();
  const { findText, setFindText, replaceText, setReplaceText, findCaseSensitive, setFindCaseSensitive, findWholeWord, setFindWholeWord, findRegex, setFindRegex, findHits, findPreviewing, previewFind } = state;
  return (
    <Section title={t("tools.edit.findReplace.title")}>
      <p className="text-sm text-muted-foreground">{t("tools.edit.findReplace.hint")}</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("tools.edit.findReplace.find")}>
          <TextInput value={findText} onChange={(event) => setFindText(event.target.value)} />
        </Field>
        <Field label={t("tools.edit.findReplace.replace")} hint={findRegex ? t("tools.edit.findReplace.groupHint") : undefined}>
          <TextInput value={replaceText} onChange={(event) => setReplaceText(event.target.value)} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Checkbox label={t("tools.edit.findReplace.caseSensitive")} checked={findCaseSensitive} onChange={setFindCaseSensitive} />
        <Checkbox label={t("tools.edit.findReplace.wholeWord")} checked={findWholeWord} onChange={setFindWholeWord} />
        <Checkbox label={t("tools.edit.findReplace.regex")} checked={findRegex} onChange={setFindRegex} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("tools.pageRange")} hint={t("tools.split.rangesHint")}>
          <TextInput value={pages} onChange={(event) => setPages(event.target.value)} placeholder={t("tools.allPages")} className="font-mono" />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button icon={<Search className="size-4" aria-hidden />} onClick={() => void previewFind()} loading={findPreviewing} disabled={!source?.info || findText.trim().length === 0}>
          {t("tools.edit.findReplace.preview")}
        </Button>
        {findHits ? (
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {t("tools.edit.findReplace.hitCount", { count: findHits.total })}
            {findHits.total > findHits.hits.length ? ` · ${t("tools.edit.findReplace.showing", { shown: findHits.hits.length })}` : ""}
            {findHits.hidden ? ` · ${t("tools.edit.findReplace.hiddenCount", { hidden: findHits.hidden })}` : ""}
          </span>
        ) : null}
      </div>
      {findHits && findHits.hits.length > 0 ? (
        <ul className="max-h-48 overflow-y-auto rounded-lg border text-sm">
          {findHits.hits.map((hit, index) => (
            <li key={`${hit.page}-${index}`} className="flex gap-3 border-b px-3 py-1.5 last:border-b-0">
              <span className="w-10 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{hit.page}</span>
              <span className="min-w-0 truncate font-mono text-xs">{hit.context}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}
