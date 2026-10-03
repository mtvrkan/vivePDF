import { useEffect, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, IdCard, ImagePlus, Plus, RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { translatorFor } from "@/app/i18n";
import { LOCALES } from "@/app/locales";
import { Button } from "@/components/shared/Button";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { IconButton } from "@/components/shared/IconButton";
import { Select } from "@/components/shared/Select";
import { Field, OptionCards, Section, Segmented, TextArea, TextInput } from "@/components/tool/form";
import { OutputPathField } from "@/components/tool/OutputPathField";
import { ResultPanel } from "@/components/tool/ResultPanel";
import { ToolLayout } from "@/components/tool/ToolLayout";
import { useOperation } from "@/shared/hooks/useOperation";
import { sanitizeFileName } from "@/shared/lib/naming";
import { basenameOf, defaultOutputDirectory, joinPath } from "@/shared/lib/paths";
import { createCv } from "@/shared/rpc/operations";
import { useToastStore } from "@/shared/store/toastStore";
import { useUiStore } from "@/shared/store/uiStore";
import type { CvLabels, Locale } from "@/types";
import { CREATE_FONTS } from "./createDocument";
import {
  CV_LABEL_KEYS,
  CV_PAPERS,
  CV_PHOTO_EXTENSIONS,
  CV_TEMPLATES,
  MAX_CV_EDUCATION,
  MAX_CV_EXPERIENCE,
  MAX_CV_SECTIONS,
  cvParams,
  emptyCvDraft,
  emptyEntry,
  emptySection,
  movedItem,
  readCvDraft,
  writeCvDraft,
  type CvDraft,
  type CvDraftEntry,
} from "./cvDocument";
import { Group } from "./Group";

type EntryKind = "experience" | "education";

const ENTRY_LIMITS: Record<EntryKind, number> = { experience: MAX_CV_EXPERIENCE, education: MAX_CV_EDUCATION };

export function CvCreator({ modeSwitch }: { modeSwitch: ReactNode }) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const toast = useToastStore((state) => state.push);
  const operation = useOperation(createCv);
  const [draft, setDraft] = useState<CvDraft>(() => readCvDraft(locale));
  const [output, setOutput] = useState("");

  useEffect(() => writeCvDraft(draft), [draft]);

  const name = draft.name;
  useEffect(() => {
    let live = true;
    const fileName = sanitizeFileName(name.trim()) ? t("tools.create.cv.fileName", { name: sanitizeFileName(name.trim()) }) : t("tools.create.cv.defaultName");
    void defaultOutputDirectory().then((directory) => {
      if (live) setOutput(joinPath(directory, `${fileName}.pdf`));
    });
    return () => {
      live = false;
    };
  }, [name, t]);

  const update = (patch: Partial<CvDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const updateEntry = (kind: EntryKind, id: string, patch: Partial<CvDraftEntry>) =>
    setDraft((current) => ({ ...current, [kind]: current[kind].map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)) }));

  const pickPhoto = async () => {
    const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: t("tools.create.cv.photo"), extensions: CV_PHOTO_EXTENSIONS }] });
    if (typeof selected === "string") update({ photo: selected });
  };

  const startOver = () => {
    const snapshot = draft;
    setDraft(emptyCvDraft(locale));
    toast("info", t("tools.create.cv.cleared"), { label: t("common.undo"), onClick: () => setDraft(snapshot) });
  };

  const ready = draft.name.trim().length > 0 && output.length > 0;

  const run = async () => {
    if (!ready) return;
    const translate = await translatorFor(draft.language);
    const labels = Object.fromEntries(CV_LABEL_KEYS.map((key) => [key, translate(`tools.create.cv.labels.${key}`)])) as CvLabels;
    void operation.run(cvParams(draft, labels, output));
  };

  const entryList = (kind: EntryKind) => (
    <>
      {draft[kind].map((entry, index) => (
        <fieldset key={entry.id} className="space-y-3 rounded-xl border p-3">
          <legend className="sr-only">{t(`tools.create.cv.entryLegend.${kind}`, { number: index + 1 })}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t(`tools.create.cv.fields.${kind}.title`)}>
              <TextInput value={entry.title} maxLength={200} onChange={(event) => updateEntry(kind, entry.id, { title: event.target.value })} aria-label={t(`tools.create.cv.fields.${kind}.title`)} />
            </Field>
            <Field label={t(`tools.create.cv.fields.${kind}.organisation`)}>
              <TextInput value={entry.organisation} maxLength={200} onChange={(event) => updateEntry(kind, entry.id, { organisation: event.target.value })} aria-label={t(`tools.create.cv.fields.${kind}.organisation`)} />
            </Field>
            <Field label={t("tools.create.cv.fields.period")}>
              <TextInput value={entry.period} maxLength={80} placeholder={t("tools.create.cv.fields.periodPlaceholder")} onChange={(event) => updateEntry(kind, entry.id, { period: event.target.value })} aria-label={t("tools.create.cv.fields.period")} />
            </Field>
            <Field label={t("tools.create.cv.fields.location")}>
              <TextInput value={entry.location} maxLength={120} onChange={(event) => updateEntry(kind, entry.id, { location: event.target.value })} aria-label={t("tools.create.cv.fields.location")} />
            </Field>
          </div>
          <Field label={t("tools.create.cv.fields.details")} hint={t("tools.create.cv.fields.detailsHint")}>
            <TextArea rows={3} value={entry.details} maxLength={4000} onChange={(event) => updateEntry(kind, entry.id, { details: event.target.value })} aria-label={t("tools.create.cv.fields.details")} />
          </Field>
          <div className="flex justify-end gap-1">
            <IconButton icon={ArrowUp} label={t("tools.merge.moveUp")} disabled={index === 0} onClick={() => setDraft((current) => ({ ...current, [kind]: movedItem(current[kind], index, -1) }))} />
            <IconButton icon={ArrowDown} label={t("tools.merge.moveDown")} disabled={index === draft[kind].length - 1} onClick={() => setDraft((current) => ({ ...current, [kind]: movedItem(current[kind], index, 1) }))} />
            <IconButton icon={X} label={t("tools.create.cv.removeEntry")} onClick={() => setDraft((current) => ({ ...current, [kind]: current[kind].filter((item) => item.id !== entry.id) }))} />
          </div>
        </fieldset>
      ))}
      <Button size="sm" icon={<Plus className="size-4" aria-hidden />} disabled={draft[kind].length >= ENTRY_LIMITS[kind]} onClick={() => setDraft((current) => ({ ...current, [kind]: [...current[kind], emptyEntry()] }))}>
        {t(`tools.create.cv.add.${kind}`)}
      </Button>
    </>
  );

  const result = operation.result;

  return (
    <ToolLayout
      title={t("tools.create.cv.title")}
      icon={IdCard}
      description={t("tools.create.cv.description")}
      actions={
        <>
          <Button variant="ghost" icon={<RotateCcw className="size-4" aria-hidden />} onClick={startOver} disabled={operation.running}>
            {t("tools.create.cv.startOver")}
          </Button>
          <Button variant="primary" onClick={() => void run()} loading={operation.running} disabled={!ready}>
            {t("tools.create.cv.run")}
          </Button>
        </>
      }
      form={
        <fieldset disabled={operation.running} className="contents">
          <Section>{modeSwitch}</Section>
          <Section title={t("tools.create.template")}>
            <OptionCards
              value={draft.template}
              onChange={(template) => update({ template })}
              ariaLabel={t("tools.create.template")}
              options={CV_TEMPLATES.map((value) => ({ value, title: t(`tools.create.cv.templates.${value}.title`), description: t(`tools.create.cv.templates.${value}.description`) }))}
            />
            <p className="text-xs text-muted-foreground">{t("tools.create.cv.draftHint")}</p>
          </Section>
          <Section title={t("tools.create.cv.personal")}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("tools.create.cv.fields.name")}>
                <TextInput value={draft.name} maxLength={120} onChange={(event) => update({ name: event.target.value })} aria-label={t("tools.create.cv.fields.name")} />
              </Field>
              <Field label={t("tools.create.cv.fields.headline")}>
                <TextInput value={draft.headline} maxLength={200} placeholder={t("tools.create.cv.fields.headlinePlaceholder")} onChange={(event) => update({ headline: event.target.value })} aria-label={t("tools.create.cv.fields.headline")} />
              </Field>
            </div>
            <Field label={t("tools.create.cv.fields.contacts")} hint={t("tools.create.cv.fields.contactsHint")}>
              <TextArea rows={3} value={draft.contacts} onChange={(event) => update({ contacts: event.target.value })} aria-label={t("tools.create.cv.fields.contacts")} />
            </Field>
            <Group label={t("tools.create.cv.photo")} hint={t("tools.create.cv.photoHint")}>
              {draft.photo ? (
                <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <ImagePlus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate" title={draft.photo}>
                    {basenameOf(draft.photo)}
                  </span>
                  <IconButton icon={X} label={t("tools.create.cv.removePhoto")} onClick={() => update({ photo: null })} />
                </div>
              ) : (
                <Button size="sm" icon={<ImagePlus className="size-4" aria-hidden />} onClick={() => void pickPhoto()}>
                  {t("tools.create.cv.pickPhoto")}
                </Button>
              )}
            </Group>
            <Field label={t("tools.create.cv.fields.summary")}>
              <TextArea rows={4} value={draft.summary} maxLength={3000} onChange={(event) => update({ summary: event.target.value })} aria-label={t("tools.create.cv.fields.summary")} />
            </Field>
          </Section>
          <Section title={t("tools.create.cv.sections.experience")}>{entryList("experience")}</Section>
          <Section title={t("tools.create.cv.sections.education")}>{entryList("education")}</Section>
          <Section title={t("tools.create.cv.sections.skills")}>
            <Field label={t("tools.create.cv.fields.skills")} hint={t("tools.create.cv.fields.skillsHint")}>
              <TextArea rows={3} value={draft.skills} onChange={(event) => update({ skills: event.target.value })} aria-label={t("tools.create.cv.fields.skills")} />
            </Field>
            <Field label={t("tools.create.cv.fields.languages")} hint={t("tools.create.cv.fields.languagesHint")}>
              <TextArea rows={3} value={draft.languages} onChange={(event) => update({ languages: event.target.value })} aria-label={t("tools.create.cv.fields.languages")} />
            </Field>
          </Section>
          <Section title={t("tools.create.cv.sections.extra")}>
            <p className="text-xs text-muted-foreground">{t("tools.create.cv.extraHint")}</p>
            {draft.sections.map((section, index) => (
              <fieldset key={section.id} className="space-y-3 rounded-xl border p-3">
                <legend className="sr-only">{t("tools.create.cv.entryLegend.extra", { number: index + 1 })}</legend>
                <Field label={t("tools.create.cv.fields.sectionHeading")}>
                  <TextInput
                    value={section.heading}
                    maxLength={100}
                    placeholder={t("tools.create.cv.fields.sectionHeadingPlaceholder")}
                    onChange={(event) => setDraft((current) => ({ ...current, sections: current.sections.map((item) => (item.id === section.id ? { ...item, heading: event.target.value } : item)) }))}
                    aria-label={t("tools.create.cv.fields.sectionHeading")}
                  />
                </Field>
                <Field label={t("tools.create.cv.fields.details")} hint={t("tools.create.cv.fields.detailsHint")}>
                  <TextArea
                    rows={3}
                    value={section.body}
                    maxLength={6000}
                    onChange={(event) => setDraft((current) => ({ ...current, sections: current.sections.map((item) => (item.id === section.id ? { ...item, body: event.target.value } : item)) }))}
                    aria-label={t("tools.create.cv.fields.details")}
                  />
                </Field>
                <div className="flex justify-end">
                  <IconButton icon={X} label={t("tools.create.cv.removeEntry")} onClick={() => setDraft((current) => ({ ...current, sections: current.sections.filter((item) => item.id !== section.id) }))} />
                </div>
              </fieldset>
            ))}
            <Button size="sm" icon={<Plus className="size-4" aria-hidden />} disabled={draft.sections.length >= MAX_CV_SECTIONS} onClick={() => setDraft((current) => ({ ...current, sections: [...current.sections, emptySection()] }))}>
              {t("tools.create.cv.add.extra")}
            </Button>
          </Section>
          <Section title={t("tools.create.look")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("tools.create.cv.language")} hint={t("tools.create.cv.languageHint")}>
                <Select value={draft.language} options={LOCALES.map((item) => ({ value: item.code, label: item.nativeName }))} onChange={(value) => update({ language: value as Locale })} ariaLabel={t("tools.create.cv.language")} />
              </Field>
              <Field label={t("tools.create.font")}>
                <Segmented value={draft.font} options={CREATE_FONTS} labelOf={(value) => t(`tools.create.fonts.${value}`)} onChange={(font) => update({ font })} ariaLabel={t("tools.create.font")} />
              </Field>
              <Field label={t("tools.create.paper")}>
                <Segmented value={draft.paper} options={CV_PAPERS} labelOf={(value) => t(`tools.create.papers.${value}`)} onChange={(paper) => update({ paper })} ariaLabel={t("tools.create.paper")} />
              </Field>
            </div>
            <Group label={t("tools.create.accent")}>
              <ColorSwatch value={draft.accent} onChange={(accent) => update({ accent })} label={t("tools.create.accent")} customLabel={t("tools.create.customColor")} />
            </Group>
          </Section>
          <Section>
            <OutputPathField value={output} onChange={setOutput} disabled={operation.running} />
          </Section>
        </fieldset>
      }
      result={
        <ResultPanel
          status={operation.status}
          progress={operation.progress}
          error={operation.error}
          numeral={result ? String(result.pageCount) : undefined}
          caption={result ? t("tools.create.resultCaption", { count: result.pageCount }) : undefined}
          outputs={result ? [result.output] : []}
          idleIcon={IdCard}
          idleTitle={t("tools.create.cv.idle.title")}
          idleDescription={t("tools.create.cv.idle.description")}
          onCancel={operation.cancel}
          onRetry={() => void run()}
          overwritePrompt={operation.overwritePrompt}
          onConfirmOverwrite={operation.confirmOverwrite}
          onDismissOverwrite={operation.dismissOverwrite}
        />
      }
    />
  );
}
