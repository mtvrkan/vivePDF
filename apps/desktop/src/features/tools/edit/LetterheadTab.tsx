import { FolderOpen, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { Field, Fieldset, OptionCards, Section, SelectInput, SwitchField, TextInput } from "@/components/tool/form";
import { basenameOf } from "@/shared/lib/paths";
import type { LetterheadTemplateRole } from "@/types";
import { TEMPLATE_PAGE } from "./editShared";
import type { LetterheadState } from "./editFormState";

export function LetterheadTab({ state, lockedTemplate, pages, onPagesChange: setPages }: { state: LetterheadState; lockedTemplate: LetterheadTemplateRole | undefined; pages: string; onPagesChange: (value: string) => void }) {
  const { t } = useTranslation();
  const { letterheadPath, letterheadFirstPath, letterheadPosition, setLetterheadPosition, letterheadFit, setLetterheadFit, letterheadReplace, setLetterheadReplace, letterheadPage, setLetterheadPage, letterheadFirstPage, setLetterheadFirstPage, letterheadPassword, setLetterheadPassword, letterheadFirstPassword, setLetterheadFirstPassword, pickLetterhead, clearFirstLetterhead, letterheadPageValid, letterheadFirstPageValid } = state;
  const askTemplatePassword = lockedTemplate === "template" || letterheadPassword.length > 0;
  const askFirstPassword = !!letterheadFirstPath && (lockedTemplate === "firstPageTemplate" || letterheadFirstPassword.length > 0);
  return (
    <Section title={t("tools.edit.letterhead.title")}>
      <p className="text-sm text-muted-foreground">{t("tools.edit.letterhead.hint")}</p>
      <Fieldset title={t("tools.edit.letterhead.template")}>
        <div className="grid grid-cols-[minmax(0,1fr)_6rem] items-start gap-3">
          <Field label={t("tools.edit.letterhead.everyPage")}>
            <div className="flex gap-2">
              <TextInput value={letterheadPath ? basenameOf(letterheadPath) : ""} readOnly className="font-mono text-sm" />
              <Button icon={<FolderOpen className="size-4" aria-hidden />} onClick={() => void pickLetterhead("main")}>{t("tools.browse")}</Button>
            </div>
          </Field>
          <Field label={t("tools.edit.letterhead.templatePage")} hint={letterheadPageValid ? undefined : t("tools.outOfRange", TEMPLATE_PAGE)}>
            <TextInput type="number" min={TEMPLATE_PAGE.min} max={TEMPLATE_PAGE.max} step={1} value={letterheadPage} onChange={(event) => setLetterheadPage(event.target.valueAsNumber)} aria-invalid={!letterheadPageValid || undefined} className="font-mono" />
          </Field>
        </div>
        {askTemplatePassword ? (
          <Field label={t("tools.edit.letterhead.password")}>
            <TextInput type="password" autoComplete="off" value={letterheadPassword} onChange={(event) => setLetterheadPassword(event.target.value)} autoFocus={lockedTemplate === "template"} />
          </Field>
        ) : null}
        <div className="grid grid-cols-[minmax(0,1fr)_6rem] items-start gap-3">
          <Field label={t("tools.edit.letterhead.firstPage")} hint={t("tools.edit.letterhead.firstPageHint")}>
            <div className="flex gap-2">
              <TextInput value={letterheadFirstPath ? basenameOf(letterheadFirstPath) : ""} readOnly className="font-mono text-sm" />
              <Button icon={<FolderOpen className="size-4" aria-hidden />} onClick={() => void pickLetterhead("first")}>{t("tools.browse")}</Button>
              {letterheadFirstPath ? <IconButton icon={X} label={t("viewer.signature.clear")} onClick={clearFirstLetterhead} /> : null}
            </div>
          </Field>
          {letterheadFirstPath ? (
            <Field label={t("tools.edit.letterhead.templatePage")} hint={letterheadFirstPageValid ? undefined : t("tools.outOfRange", TEMPLATE_PAGE)}>
              <TextInput type="number" min={TEMPLATE_PAGE.min} max={TEMPLATE_PAGE.max} step={1} value={letterheadFirstPage} onChange={(event) => setLetterheadFirstPage(event.target.valueAsNumber)} aria-invalid={!letterheadFirstPageValid || undefined} className="font-mono" />
            </Field>
          ) : null}
        </div>
        {askFirstPassword ? (
          <Field label={t("tools.edit.letterhead.password")}>
            <TextInput type="password" autoComplete="off" value={letterheadFirstPassword} onChange={(event) => setLetterheadFirstPassword(event.target.value)} autoFocus={lockedTemplate === "firstPageTemplate"} />
          </Field>
        ) : null}
      </Fieldset>
      <OptionCards
        value={letterheadPosition}
        onChange={setLetterheadPosition}
        ariaLabel={t("tools.edit.letterhead.position")}
        options={[
          { value: "under", title: t("tools.edit.letterhead.positions.under"), description: t("tools.edit.letterhead.positionHints.under") },
          { value: "over", title: t("tools.edit.letterhead.positions.over"), description: t("tools.edit.letterhead.positionHints.over") },
        ]}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("tools.edit.letterhead.fit")} hint={t("tools.edit.letterhead.fitHint")}>
          <SelectInput value={letterheadFit} aria-label={t("tools.edit.letterhead.fit")} onChange={(event) => setLetterheadFit(event.target.value as "stretch" | "fit")}>
            <option value="stretch">{t("tools.edit.letterhead.fits.stretch")}</option>
            <option value="fit">{t("tools.edit.letterhead.fits.fit")}</option>
          </SelectInput>
        </Field>
        <Field label={t("tools.pageRange")} hint={t("tools.split.rangesHint")}>
          <TextInput value={pages} onChange={(event) => setPages(event.target.value)} placeholder={t("tools.allPages")} className="font-mono" />
        </Field>
      </div>
      <SwitchField label={t("tools.edit.letterhead.replaceExisting")} hint={t("tools.edit.letterhead.replaceExistingHint")} checked={letterheadReplace} onChange={setLetterheadReplace} />
    </Section>
  );
}
