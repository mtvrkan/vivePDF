import { useEffect, useRef, useState } from "react";
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

  const dirty = FIELDS.some((field) => (metadata?.[field] ?? "") !== values[field]);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    const sameDocument = loadedFor.current === document.id;
    if (sameDocument && dirtyRef.current) return;
    loadedFor.current = document.id;
    setValues({
      title: metadata?.title ?? "",
      author: metadata?.author ?? "",
      subject: metadata?.subject ?? "",
      keywords: metadata?.keywords ?? "",
    });
  }, [metadata, document.id]);

  const save = async () => {
    setSaving(true);
    try {
      const store = usePendingChangesStore.getState();
      const before = new Set((store.changes[document.id] ?? []).map((change) => change.id));
      store.queue(document.id, { kind: "metadataChanged", metadata: { ...values }, label: t("viewer.metadata.title") });
      const saved = await saveDocument();
      if (!saved) {
        const state = usePendingChangesStore.getState();
        for (const change of state.changes[document.id] ?? []) {
          if (change.kind === "metadataChanged" && !before.has(change.id)) state.drop(document.id, change.id);
        }
      }
    } finally {
      setSaving(false);
    }
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
