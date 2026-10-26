import { useState } from "react";
import { UnfoldVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEditorState, type Editor } from "@tiptap/react";
import { Button } from "@/components/shared/Button";
import { ContextMenu, MENU_LAYER, type ContextMenuAnchor, type ContextMenuItem } from "@/components/shared/ContextMenu";
import { Dialog } from "@/components/shared/Dialog";
import { IconButton } from "@/components/shared/IconButton";
import { SliderField } from "@/components/tool/form";
import { useDocumentStore } from "./documentStore";
import { FIRST_LINE_INDENT, LINE_PRESETS, PARAGRAPH_GAP, SPACING_KEYS, SPACING_LIMITS, spacingValue, type Spacing, type SpacingKey } from "./spacing";

const MENU_GAP = 4;
const STEPS: Record<SpacingKey, number> = { lineHeight: 0.05, spaceBefore: 1, spaceAfter: 1, indentLeft: 1, indentRight: 1, firstLineIndent: 1 };
const DEFAULT_GAP_RATIO = 0.6;

function currentSpacing(editor: Editor): Spacing {
  const attributes = editor.isActive("heading") ? editor.getAttributes("heading") : editor.getAttributes("paragraph");
  return Object.fromEntries(SPACING_KEYS.map((key) => [key, spacingValue(key, attributes[key])])) as Spacing;
}

function SpacingDialog({ editor, initial, onClose }: { editor: Editor; initial: Spacing; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const settings = useDocumentStore((state) => state.document?.settings);
  const fallback: Record<SpacingKey, number> = {
    lineHeight: settings?.lineHeight ?? 1.4,
    spaceBefore: 0,
    spaceAfter: Math.round((settings?.fontSize ?? 11) * DEFAULT_GAP_RATIO),
    indentLeft: 0,
    indentRight: 0,
    firstLineIndent: 0,
  };
  const [values, setValues] = useState<Record<SpacingKey, number>>(() => Object.fromEntries(SPACING_KEYS.map((key) => [key, initial[key] ?? fallback[key]])) as Record<SpacingKey, number>);
  const [touched, setTouched] = useState<Set<SpacingKey>>(() => new Set(SPACING_KEYS.filter((key) => initial[key] !== null)));
  const number = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 });
  const change = (key: SpacingKey, value: number) => {
    setValues((current) => ({ ...current, [key]: value }));
    setTouched((current) => new Set(current).add(key));
  };
  const apply = () => {
    editor
      .chain()
      .focus()
      .setSpacing(Object.fromEntries(SPACING_KEYS.map((key) => [key, touched.has(key) ? values[key] : null])))
      .run();
    onClose();
  };
  const reset = () => {
    editor.chain().focus().unsetSpacing().run();
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t("studio.doc.spacing.custom")}
      footer={
        <>
          <Button variant="ghost" onClick={reset} className="mr-auto">
            {t("studio.doc.spacing.reset")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={apply}>
            {t("studio.doc.spacing.apply")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {SPACING_KEYS.map((key) => (
          <SliderField
            key={key}
            label={t(`studio.doc.spacing.fields.${key}`)}
            value={values[key]}
            min={SPACING_LIMITS[key][0]}
            max={SPACING_LIMITS[key][1]}
            step={STEPS[key]}
            format={(value) => (key === "lineHeight" ? number.format(value) : `${number.format(value)} pt`)}
            onChange={(value) => change(key, value)}
          />
        ))}
      </div>
    </Dialog>
  );
}

export function SpacingMenu({ editor }: { editor: Editor }) {
  const { t, i18n } = useTranslation();
  const [anchor, setAnchor] = useState<ContextMenuAnchor | null>(null);
  const [custom, setCustom] = useState<Spacing | null>(null);
  const spacing = useEditorState({ editor, selector: ({ editor: current }) => currentSpacing(current) });
  const number = new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  const set = (values: Partial<Spacing>) => editor.chain().focus().setSpacing(values).run();
  const label = t("studio.doc.spacing.label");

  const items: ContextMenuItem[] = [
    { type: "item", id: "line-default", label: t("studio.doc.spacing.lineDefault"), checked: spacing.lineHeight === null, onSelect: () => set({ lineHeight: null }) },
    ...LINE_PRESETS.map((preset): ContextMenuItem => ({ type: "item", id: `line-${preset}`, label: number.format(preset), checked: spacing.lineHeight === preset, onSelect: () => set({ lineHeight: preset }) })),
    { type: "separator", id: "gaps" },
    { type: "item", id: "before", label: t("studio.doc.spacing.before"), checked: (spacing.spaceBefore ?? 0) > 0, onSelect: () => set({ spaceBefore: (spacing.spaceBefore ?? 0) > 0 ? null : PARAGRAPH_GAP }) },
    { type: "item", id: "after", label: t("studio.doc.spacing.after"), checked: (spacing.spaceAfter ?? 0) > 0, onSelect: () => set({ spaceAfter: (spacing.spaceAfter ?? 0) > 0 ? null : PARAGRAPH_GAP }) },
    { type: "item", id: "indent", label: t("studio.doc.spacing.firstLine"), checked: (spacing.firstLineIndent ?? 0) > 0, onSelect: () => set({ firstLineIndent: (spacing.firstLineIndent ?? 0) > 0 ? null : FIRST_LINE_INDENT }) },
    { type: "separator", id: "more" },
    { type: "item", id: "custom", label: t("studio.doc.spacing.customItem"), onSelect: () => setCustom(currentSpacing(editor)) },
  ];

  return (
    <span {...{ [MENU_LAYER]: "" }} className="inline-flex">
      <IconButton
        icon={UnfoldVertical}
        label={label}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        data-testid="doc-spacing"
        onClick={(event) => {
          if (anchor) {
            setAnchor(null);
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          setAnchor({ x: rect.left, y: rect.bottom + MENU_GAP });
        }}
      />
      {anchor ? <ContextMenu anchor={anchor} items={items} label={label} onClose={() => setAnchor(null)} /> : null}
      {custom ? <SpacingDialog editor={editor} initial={custom} onClose={() => setCustom(null)} /> : null}
    </span>
  );
}
