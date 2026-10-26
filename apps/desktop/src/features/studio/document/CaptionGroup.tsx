import { useState } from "react";
import { Captions, GalleryVerticalEnd } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { Button } from "@/components/shared/Button";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { Dialog } from "@/components/shared/Dialog";
import { Field, TextInput } from "@/components/tool/form";
import type { DocumentSettings } from "@/types/studio";
import { RibbonButton, RibbonGroup } from "../ribbon/Ribbon";
import { CAPTION_KINDS } from "./captionCounter";
import { useDocumentStore } from "./documentStore";

const update = (patch: Partial<DocumentSettings>) => useDocumentStore.getState().setSettings(patch);

export function CaptionGroup({ editor, settings }: { editor: Editor; settings: DocumentSettings | undefined }) {
  const { t } = useTranslation();
  const [naming, setNaming] = useState(false);
  const captionItems: ContextMenuItem[] = CAPTION_KINDS.map((kind) => ({
    type: "item",
    id: `caption-${kind}`,
    label: t(`studio.doc.caption.${kind}`),
    onSelect: () => editor.chain().focus().insertCaption(kind, t(`studio.doc.caption.${kind}Label`)).run(),
  }));
  const listItems: ContextMenuItem[] = settings
    ? [
        { type: "item", id: "figure-list", label: t("studio.doc.caption.figureList"), checked: settings.figureList, onSelect: () => update({ figureList: !settings.figureList }) },
        { type: "item", id: "table-list", label: t("studio.doc.caption.tableList"), checked: settings.tableList, onSelect: () => update({ tableList: !settings.tableList }) },
        { type: "separator", id: "list-more" },
        { type: "item", id: "list-titles", label: t("studio.doc.caption.listTitles"), onSelect: () => setNaming(true) },
      ]
    : [];
  return (
    <RibbonGroup label={t("studio.doc.ribbon.groups.captions")}>
      <RibbonButton icon={Captions} label={t("studio.doc.caption.insert")} menu={captionItems} testId="doc-caption" />
      {settings ? <RibbonButton icon={GalleryVerticalEnd} label={t("studio.doc.caption.lists")} active={settings.figureList || settings.tableList} menu={listItems} testId="doc-caption-lists" /> : null}
      {naming && settings ? (
        <Dialog
          open
          onClose={() => setNaming(false)}
          title={t("studio.doc.caption.lists")}
          footer={
            <Button variant="primary" onClick={() => setNaming(false)}>
              {t("common.close")}
            </Button>
          }
        >
          <div className="grid gap-3">
            <Field label={t("studio.doc.caption.figureListTitle")} hint={t("studio.doc.caption.listsHint")}>
              <TextInput autoFocus value={settings.figureListTitle} maxLength={100} placeholder={t("studio.doc.caption.figureList")} onChange={(event) => update({ figureListTitle: event.target.value })} data-testid="doc-figure-list-title" />
            </Field>
            <Field label={t("studio.doc.caption.tableListTitle")}>
              <TextInput value={settings.tableListTitle} maxLength={100} placeholder={t("studio.doc.caption.tableList")} onChange={(event) => update({ tableListTitle: event.target.value })} data-testid="doc-table-list-title" />
            </Field>
          </div>
        </Dialog>
      ) : null}
    </RibbonGroup>
  );
}
