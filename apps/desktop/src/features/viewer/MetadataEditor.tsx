import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Field, TextInput } from "@/components/tool/form";
import { usePendingChangesStore } from "@/shared/store/pendingChangesStore";
import type { OpenDocument } from "@/types";
import { useDocumentSave } from "./useDocumentSave";

const FIELDS = ["title", "author", "subject", "keywords"] as const;
type FieldName = (typeof FIELDS)[number];

export function MetadataEditor({ document }: { document: OpenDocument }) {
  const { t } = useTranslation();
  const { save: saveDocument } = useDocumentSave(document.id);
  const [values, setValues] = useState<Record<FieldName, string>>({ title: "", author: "", subject: "", keywords: "" });
  const [saving, setSaving] = useState(false);
  const metadata = document.info?.metadata;

  useEffect(() => {
    setValues({
      title: metadata?.title ?? "",
      author: metadata?.author ?? "",
      subject: metadata?.subject ?? "",
      keywords: metadata?.keywords ?? "",
    });
  }, [metadata]);

  const dirty = FIELDS.some((field) => (metadata?.[field] ?? "") !== values[field]);

  const save = async () => {
    setSaving(true);
    usePendingChangesStore.getState().queue(document.id, { kind: "metadataChanged", metadata: { ...values }, label: t("viewer.metadata.title") });
    await saveDocument();
    setSaving(false);
  };

  return (
    <section className="mt-4 rounded-md border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">{t("viewer.metadata.title")}</h2>
      <div className="flex flex-col gap-3">
        {FIELDS.map((field) => (
          <Field key={field} label={t(`viewer.metadata.fields.${field}`)}>
            <TextInput value={values[field]} onChange={(event) => setValues((state) => ({ ...state, [field]: event.target.value }))} className="h-8 text-sm" />
          </Field>
        ))}
        <div className="flex justify-end">
          <Button size="sm" variant="primary" icon={<Save className="size-4" aria-hidden />} onClick={() => void save()} disabled={!dirty || saving} loading={saving}>
            {t("viewer.metadata.save")}
          </Button>
        </div>
      </div>
    </section>
  );
}
