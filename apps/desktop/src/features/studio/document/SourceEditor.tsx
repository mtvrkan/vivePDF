import { DownloadCloud, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { Select } from "@/components/shared/Select";
import { Field, TextArea, TextInput } from "@/components/tool/form";
import { MAX_FIELD_CHARS } from "./bibtex";
import { looksTitleCase, SENTENCE_TITLE_TYPES, sentenceCase, titleLocale } from "./sentenceCase";
import { EDITABLE_TYPES, fieldNameOf, MAX_FIELD_NAME, otherFields, shownFields, slotLabel, type KeyProblem, type SourceDraft } from "./sourceDraft";

const LONG_FIELDS = new Set(["abstract", "annotation", "annote"]);

export function SourceEditor({
  draft,
  problem,
  onChange,
  onFillFromDoi,
  filling = false,
  sentenceTitles = false,
  language = "en-US",
}: {
  draft: SourceDraft;
  problem: KeyProblem | null;
  onChange: (draft: SourceDraft) => void;
  onFillFromDoi?: () => void;
  filling?: boolean;
  sentenceTitles?: boolean;
  language?: string;
}) {
  const { t } = useTranslation();
  const types = EDITABLE_TYPES.includes(draft.type) ? EDITABLE_TYPES : [...EDITABLE_TYPES, draft.type];
  const setField = (name: string, value: string) => onChange({ ...draft, fields: { ...draft.fields, [name]: value } });
  const title = draft.fields.title ?? "";
  const locale = titleLocale(draft.fields.language, language);
  const titleCased = sentenceTitles && SENTENCE_TITLE_TYPES.has(draft.type) && looksTitleCase(title, locale);
  const [newField, setNewField] = useState("");
  const shown = shownFields(draft.type, draft.fields);
  const others = otherFields(draft.type, draft.fields);
  const newName = fieldNameOf(newField);
  const nameTaken = newName !== null && (newName === "title" || shown.includes(newName) || others.includes(newName));
  const addField = () => {
    if (!newName || nameTaken) return;
    onChange({ ...draft, fields: { ...draft.fields, [newName]: "" } });
    setNewField("");
  };
  const removeField = (name: string) => onChange({ ...draft, fields: Object.fromEntries(Object.entries(draft.fields).filter(([field]) => field !== name)) });

  return (
    <div className="space-y-3" data-testid="cite-editor">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("studio.doc.cite.type")}>
          <Select
            value={draft.type}
            options={types.map((type) => ({ value: type, label: EDITABLE_TYPES.includes(type) ? t(`studio.doc.cite.types.${type}`) : `@${type}` }))}
            onChange={(type) => onChange({ ...draft, type })}
            ariaLabel={t("studio.doc.cite.type")}
          />
        </Field>
        <Field
          label={t("studio.doc.cite.key")}
          hint={t("studio.doc.cite.keyHint")}
          note={
            problem ? (
              <p role="alert" className="mt-1.5 text-xs text-destructive">
                {t(`studio.doc.cite.keyProblems.${problem}`)}
              </p>
            ) : null
          }
        >
          <TextInput value={draft.key} maxLength={200} spellCheck={false} aria-invalid={problem !== null} onChange={(event) => onChange({ ...draft, key: event.target.value })} className="font-mono" />
        </Field>
      </div>
      <Field
        label={t("studio.doc.cite.fields.title")}
        note={
          titleCased ? (
            <div role="status" className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-warning" data-testid="cite-title-case">
              <span>{t("studio.doc.cite.sentenceCase.warning")}</span>
              <Button variant="ghost" size="sm" onClick={() => setField("title", sentenceCase(title, locale))} data-testid="cite-sentence-case">
                {t("studio.doc.cite.sentenceCase.convert")}
              </Button>
            </div>
          ) : null
        }
      >
        <TextInput autoFocus value={title} maxLength={MAX_FIELD_CHARS} onChange={(event) => setField("title", event.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("studio.doc.cite.authors")} hint={t("studio.doc.cite.namesHint")}>
          <TextArea rows={3} value={draft.authors} maxLength={20_000} spellCheck={false} onChange={(event) => onChange({ ...draft, authors: event.target.value })} />
        </Field>
        <Field label={t("studio.doc.cite.editors")}>
          <TextArea rows={3} value={draft.editors} maxLength={20_000} spellCheck={false} onChange={(event) => onChange({ ...draft, editors: event.target.value })} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {shown.map((name) => {
          const fillable = name === "doi" && onFillFromDoi !== undefined;
          const field = (
            <Field key={name} label={t(`studio.doc.cite.fields.${slotLabel(name)}`)} className={fillable ? "min-w-0 flex-1" : undefined}>
              <TextInput value={draft.fields[name] ?? ""} maxLength={MAX_FIELD_CHARS} spellCheck={name !== "doi" && name !== "url"} onChange={(event) => setField(name, event.target.value)} />
            </Field>
          );
          if (!fillable) return field;
          return (
            <div key={name} className="flex items-end gap-2">
              {field}
              <IconButton icon={DownloadCloud} label={t("studio.doc.cite.fillFromDoi")} busy={filling} disabled={filling || !draft.fields.doi?.trim()} onClick={onFillFromDoi} className="size-row" data-testid="cite-fill-doi" />
            </div>
          );
        })}
      </div>
      <section className="space-y-3 border-t border-border pt-3" aria-label={t("studio.doc.cite.otherFields")} data-testid="cite-other-fields">
        <h3 className="text-xs font-medium text-muted-foreground">{t("studio.doc.cite.otherFields")}</h3>
        {others.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {others.map((name) => (
              <div key={name} className={LONG_FIELDS.has(name) ? "flex items-end gap-2 sm:col-span-2" : "flex items-end gap-2"}>
                <Field label={name} className="min-w-0 flex-1">
                  {LONG_FIELDS.has(name) ? (
                    <TextArea rows={3} value={draft.fields[name] ?? ""} maxLength={MAX_FIELD_CHARS} onChange={(event) => setField(name, event.target.value)} />
                  ) : (
                    <TextInput value={draft.fields[name] ?? ""} maxLength={MAX_FIELD_CHARS} onChange={(event) => setField(name, event.target.value)} />
                  )}
                </Field>
                <IconButton icon={X} label={t("studio.doc.cite.removeField", { name })} onClick={() => removeField(name)} className="size-row" />
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <Field label={t("studio.doc.cite.fieldName")} className="min-w-0 flex-1">
            <TextInput
              value={newField}
              maxLength={MAX_FIELD_NAME}
              spellCheck={false}
              placeholder="abstract, keywords, issn"
              aria-invalid={newField.trim() !== "" && (newName === null || nameTaken)}
              onChange={(event) => setNewField(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                addField();
              }}
              className="font-mono"
              data-testid="cite-new-field"
            />
          </Field>
          <Button variant="ghost" onClick={addField} disabled={!newName || nameTaken} data-testid="cite-add-field">
            {t("studio.doc.cite.addField")}
          </Button>
        </div>
      </section>
    </div>
  );
}
