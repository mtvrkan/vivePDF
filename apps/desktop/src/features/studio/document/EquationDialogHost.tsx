import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { FormulaDialog, type FormulaSubmit } from "@/features/viewer/overlay/formula/FormulaDialog";
import { DEFAULT_FORMULA_SIZE } from "@/features/viewer/overlay/formula/formulaSvg";
import { useToastStore } from "@/shared/store/toastStore";
import { useEquationEditing } from "./equationEditing";
import { EQUATION, EQUATION_BLOCK, EQUATION_COLOUR, MAX_EQUATIONS, equationArt } from "./equations";

function equationCount(editor: Editor): number {
  let count = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === EQUATION || node.type.name === EQUATION_BLOCK) count += 1;
    return true;
  });
  return count;
}

export function EquationDialogHost({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const request = useEquationEditing((state) => state.request);
  if (!request) return null;
  const updating = request.position !== null;
  const block = request.kind === "block";
  const close = () => useEquationEditing.getState().close();

  const submit = ({ formula, depth }: FormulaSubmit) => {
    const art = equationArt({ latex: formula.latex, svg: formula.svg, width: formula.emWidth, height: formula.emHeight, depth });
    if (!art) {
      useToastStore.getState().push("error", t("studio.doc.equation.tooLarge"));
      return;
    }
    const chain = editor.chain().focus();
    if (request.position !== null) chain.updateEquation(request.position, art).run();
    else if (equationCount(editor) >= MAX_EQUATIONS) {
      useToastStore.getState().push("error", t("studio.doc.equation.tooMany", { count: MAX_EQUATIONS }));
      return;
    } else if (block) chain.insertEquationBlock(art).run();
    else chain.insertEquation(art).run();
    close();
  };

  return (
    <FormulaDialog
      key={`${request.kind}-${request.position ?? "new"}`}
      initial={{ latex: request.latex, color: EQUATION_COLOUR, size: DEFAULT_FORMULA_SIZE }}
      updating={updating}
      display={block}
      plain
      title={t(updating ? "studio.doc.equation.editTitle" : block ? "studio.doc.equation.numberedTitle" : "studio.doc.equation.inlineTitle")}
      onClose={close}
      onSubmit={submit}
    />
  );
}
