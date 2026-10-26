import { useState } from "react";
import { FileText, GraduationCap, ListTree } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { Dialog } from "@/components/shared/Dialog";
import { Field, TextInput } from "@/components/tool/form";
import { useToastStore } from "@/shared/store/toastStore";
import type { DocumentSettings } from "@/types/studio";
import { RibbonButton } from "../ribbon/Ribbon";
import { useDocumentStore } from "./documentStore";
import { COVER_STYLES } from "./model";
import { applySystemDocumentFont } from "./documentFonts";
import { THESIS_FONT, THESIS_LAYOUTS, THESIS_RULES, thesisRuleOf, type ThesisRule } from "./thesisRules";

const DEPTHS = [1, 2, 3] as const;
const COVER_FIELDS = [
  { key: "title", limit: 300 },
  { key: "subtitle", limit: 300 },
  { key: "author", limit: 300 },
  { key: "date", limit: 80 },
] as const;

const update = (patch: Partial<DocumentSettings>) => useDocumentStore.getState().setSettings(patch);

function CloseFooter({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Button variant="primary" onClick={onClose}>
      {t("common.close")}
    </Button>
  );
}

export function CoverDetailsDialog({ settings, onClose }: { settings: DocumentSettings; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open onClose={onClose} title={t("studio.doc.ribbon.coverDetailsTitle")} footer={<CloseFooter onClose={onClose} />}>
      <div className="grid gap-3" data-testid="doc-cover-details">
        {COVER_FIELDS.map(({ key, limit }, index) => (
          <Field key={key} label={t(`studio.doc.settings.${key}`)}>
            <TextInput autoFocus={index === 0} value={settings[key]} maxLength={limit} onChange={(event) => update({ [key]: event.target.value })} />
          </Field>
        ))}
      </div>
    </Dialog>
  );
}

export function CoverMenu({ settings }: { settings: DocumentSettings }) {
  const { t } = useTranslation();
  const [details, setDetails] = useState(false);
  const items: ContextMenuItem[] = [
    { type: "item", id: "cover-none", label: t("studio.doc.ribbon.coverNone"), checked: !settings.cover, onSelect: () => update({ cover: false }) },
    ...COVER_STYLES.map((style): ContextMenuItem => ({
      type: "item",
      id: `cover-${style}`,
      label: t(`studio.doc.covers.${style}`),
      checked: settings.cover && settings.coverStyle === style,
      onSelect: () => {
        update({ cover: true, coverStyle: style });
        if (!settings.cover && !settings.title.trim()) setDetails(true);
      },
    })),
    { type: "separator", id: "cover-more" },
    { type: "item", id: "cover-details", label: t("studio.doc.ribbon.coverDetails"), onSelect: () => setDetails(true) },
  ];
  return (
    <>
      <RibbonButton icon={FileText} label={t("studio.doc.ribbon.cover")} active={settings.cover} menu={items} testId="doc-cover" />
      {details ? <CoverDetailsDialog settings={settings} onClose={() => setDetails(false)} /> : null}
    </>
  );
}

export function ThesisRulesMenu({ settings }: { settings: DocumentSettings }) {
  const { t } = useTranslation();
  const current = thesisRuleOf(settings);
  const apply = async (rule: ThesisRule) => {
    update(THESIS_LAYOUTS[rule]);
    const fonted = await applySystemDocumentFont(THESIS_FONT);
    useToastStore.getState().push(fonted ? "success" : "info", t(fonted ? "studio.doc.thesis.applied" : "studio.doc.thesis.noFont"));
  };
  const items: ContextMenuItem[] = [
    ...THESIS_RULES.map((rule): ContextMenuItem => ({ type: "item", id: `thesis-${rule}`, label: t(`studio.doc.thesis.${rule}`), checked: current === rule, onSelect: () => void apply(rule) })),
    { type: "separator", id: "thesis-shared" },
    { type: "item", id: "thesis-note", label: t("studio.doc.thesis.shared"), disabled: true, onSelect: () => undefined },
  ];
  return <RibbonButton icon={GraduationCap} label={t("studio.doc.ribbon.thesisRules")} active={current !== null} menu={items} testId="doc-thesis-rules" />;
}

export function ContentsMenu({ settings }: { settings: DocumentSettings }) {
  const { t } = useTranslation();
  const [naming, setNaming] = useState(false);
  const items: ContextMenuItem[] = [
    { type: "item", id: "toc-none", label: t("studio.doc.ribbon.tocNone"), checked: !settings.toc, onSelect: () => update({ toc: false }) },
    ...DEPTHS.map((depth): ContextMenuItem => ({
      type: "item",
      id: `toc-${depth}`,
      label: t("studio.doc.settings.depth", { count: depth }),
      checked: settings.toc && settings.tocDepth === depth,
      onSelect: () => update({ toc: true, tocDepth: depth }),
    })),
    { type: "separator", id: "toc-more" },
    { type: "item", id: "toc-title", label: t("studio.doc.ribbon.tocTitle"), onSelect: () => setNaming(true) },
  ];
  return (
    <>
      <RibbonButton icon={ListTree} label={t("studio.doc.ribbon.toc")} active={settings.toc} menu={items} testId="doc-toc" />
      {naming ? (
        <Dialog open onClose={() => setNaming(false)} title={t("studio.doc.settings.contents")} footer={<CloseFooter onClose={() => setNaming(false)} />}>
          <Field label={t("studio.doc.settings.tocTitle")} hint={t("studio.doc.settings.tocHint")}>
            <TextInput autoFocus value={settings.tocTitle} maxLength={100} placeholder={t("studio.doc.settings.tocTitleDefault")} onChange={(event) => update({ tocTitle: event.target.value })} data-testid="doc-toc-title" />
          </Field>
        </Dialog>
      ) : null}
    </>
  );
}
