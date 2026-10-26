import { Sigma } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEditorState, type Editor } from "@tiptap/react";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { RibbonButton } from "../ribbon/Ribbon";
import { useEquationEditing } from "./equationEditing";
import { numberedEquations } from "./equationNodes";
import { equationLabel } from "./equations";

const PREVIEW_LENGTH = 32;

function preview(latex: string): string {
  const flat = latex.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH)}…` : flat;
}

export function EquationMenu({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const equations = useEditorState({ editor, selector: ({ editor: current }) => numberedEquations(current.state.doc) });
  const references: ContextMenuItem[] = equations.length
    ? equations.map((equation): ContextMenuItem => ({
        type: "item",
        id: `equation-ref-${equation.id}`,
        label: `${equationLabel(equation.number)} ${preview(equation.latex)}`,
        onSelect: () => editor.chain().focus().insertEquationRef(equation.id).run(),
      }))
    : [{ type: "item", id: "equation-ref-none", label: t("studio.doc.equation.noneYet"), disabled: true, onSelect: () => undefined }];
  const items: ContextMenuItem[] = [
    { type: "item", id: "equation-block", label: t("studio.doc.equation.numbered"), onSelect: () => useEquationEditing.getState().open("block") },
    { type: "item", id: "equation-inline", label: t("studio.doc.equation.inline"), onSelect: () => useEquationEditing.getState().open("inline") },
    { type: "separator", id: "equation-references" },
    { type: "submenu", id: "equation-reference", label: t("studio.doc.equation.reference"), items: references },
  ];

  return <RibbonButton icon={Sigma} label={t("studio.doc.ribbon.equation")} menu={items} testId="doc-equation" />;
}
