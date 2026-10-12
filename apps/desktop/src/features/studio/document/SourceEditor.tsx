import { DownloadCloud } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { Select } from "@/components/shared/Select";
import { Field, TextArea, TextInput } from "@/components/tool/form";
import { MAX_FIELD_CHARS } from "./bibtex";
import { EDITABLE_TYPES, shownFields, type KeyProblem, type SourceDraft } from "./sourceDraft";

export function SourceEditor({
  draft,
  problem,
  onChange,
  onFillFromDoi,
  filling = false,
}: {
  draft: SourceDraft;
  problem: KeyProblem | null;
  onChange: (draft: SourceDraft) => void;
  onFillFromDoi?: () => void;
  filling?: boolean;
}) {
  const { t } = useTranslation();
  const types = EDITABLE_TYPES.includes(draft.type) ? EDITABLE_TYPES : [...EDITABLE_TYPES, draft.type];
  const setField = (name: string, value: string) => onChange({ ...draft, fields: { ...draft.fields, [name]: value } });

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
      <Field label={t("studio.doc.cite.fields.title")}>
        <TextInput autoFocus value={draft.fields.title ?? ""} maxLength={MAX_FIELD_CHARS} onChange={(event) => setField("title", event.target.value)} />
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
        {shownFields(draft.type, draft.fields).map((name) => {
          const fillable = name === "doi" && onFillFromDoi !== undefined;
          const field = (
            <Field key={name} label={t(`studio.doc.cite.fields.${name}`)} className={fillable ? "min-w-0 flex-1" : undefined}>
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
    </div>
  );
}
