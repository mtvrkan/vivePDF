import { Node, mergeAttributes, type AnyExtension } from "@tiptap/core";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { formulaDataUrl } from "@/features/viewer/overlay/formula/formulaSvg";
import { EQUATION, EQUATION_BLOCK, EQUATION_COLOUR, EQUATION_REF, equationArt, equationId, equationLabel, newEquationId, type EquationArt } from "./equations";
import { useEquationEditing } from "./equationEditing";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    equation: {
      insertEquation: (art: EquationArt) => ReturnType;
      insertEquationBlock: (art: EquationArt) => ReturnType;
      insertEquationRef: (id: string) => ReturnType;
      updateEquation: (position: number, art: EquationArt) => ReturnType;
    };
  }
}

export type NumberedEquation = { id: string; number: number; latex: string };

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function numberAttribute(name: string) {
  return {
    default: 0,
    parseHTML: (element: HTMLElement) => Number(element.getAttribute(`data-${name}`)) || 0,
    renderHTML: (attributes: Record<string, unknown>) => ({ [`data-${name}`]: String(attributes[name]) }),
  };
}

function artAttributes() {
  return {
    latex: { default: "", parseHTML: (element: HTMLElement) => element.getAttribute("data-latex") ?? "", renderHTML: (attributes: Record<string, unknown>) => ({ "data-latex": attributes.latex }) },
    svg: { default: "", parseHTML: (element: HTMLElement) => element.getAttribute("data-svg") ?? "", renderHTML: (attributes: Record<string, unknown>) => ({ "data-svg": attributes.svg }) },
    width: numberAttribute("width"),
    height: numberAttribute("height"),
    depth: numberAttribute("depth"),
  };
}

function picture(node: ProseNode, inline: boolean): [string, Record<string, string>] {
  const art = equationArt(node.attrs);
  if (!art) return ["span", { class: "vp-eq-broken" }];
  const style = `width:${rounded(art.width)}em;height:${rounded(art.height)}em${inline ? `;vertical-align:-${rounded(art.depth)}em` : ""}`;
  return ["img", { src: formulaDataUrl({ svg: art.svg, color: EQUATION_COLOUR, emWidth: art.width, emHeight: art.height }), alt: art.latex, draggable: "false", style }];
}

export function numberedEquations(doc: ProseNode): NumberedEquation[] {
  const found: NumberedEquation[] = [];
  const seen = new Set<string>();
  let count = 0;
  doc.descendants((node) => {
    if (node.type.name !== EQUATION_BLOCK) return true;
    const art = equationArt(node.attrs);
    if (!art) return false;
    count += 1;
    const id = equationId(node.attrs.id);
    if (id && !seen.has(id)) {
      seen.add(id);
      found.push({ id, number: count, latex: art.latex });
    }
    return false;
  });
  return found;
}

function decorations(doc: ProseNode): DecorationSet {
  const numbers = new Map<string, number>();
  const marks: Decoration[] = [];
  let count = 0;
  doc.descendants((node, position) => {
    if (node.type.name !== EQUATION_BLOCK) return true;
    if (!equationArt(node.attrs)) return false;
    count += 1;
    const id = equationId(node.attrs.id);
    if (id && !numbers.has(id)) numbers.set(id, count);
    marks.push(Decoration.node(position, position + node.nodeSize, { "data-number": equationLabel(count) }));
    return false;
  });
  doc.descendants((node, position) => {
    if (node.type.name !== EQUATION_REF) return true;
    const label = equationLabel(numbers.get(equationId(node.attrs.target) ?? ""));
    marks.push(Decoration.node(position, position + node.nodeSize, { "data-number": label, "aria-label": label }));
    return false;
  });
  return marks.length ? DecorationSet.create(doc, marks) : DecorationSet.empty;
}

const equationNumbersKey = new PluginKey<DecorationSet>("documentEquationNumbers");

const editable = new Set([EQUATION, EQUATION_BLOCK]);

const equationPlugin = new Plugin<DecorationSet>({
  key: equationNumbersKey,
  state: {
    init: (_, state) => decorations(state.doc),
    apply: (tr, value, _, state) => (tr.docChanged ? decorations(state.doc) : value),
  },
  props: {
    decorations: (state) => equationNumbersKey.getState(state),
    handleDoubleClickOn: (_view, _position, node, nodePosition) => {
      if (!editable.has(node.type.name)) return false;
      useEquationEditing.getState().edit(node.type.name === EQUATION_BLOCK ? "block" : "inline", nodePosition, String(node.attrs.latex ?? ""));
      return true;
    },
  },
});

export const Equation = Node.create({
  name: EQUATION,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: artAttributes,
  parseHTML: () => [{ tag: "span[data-equation]", priority: 100 }],
  renderHTML: ({ node, HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { class: "vp-eq", "data-equation": "" }), picture(node, true)],
  renderText: () => "",
  addCommands() {
    return {
      insertEquation:
        (art) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: art }),
      updateEquation:
        (position, art) =>
        ({ tr, dispatch }) => {
          const node = tr.doc.nodeAt(position);
          if (!node || !editable.has(node.type.name)) return false;
          if (dispatch) tr.setNodeMarkup(position, undefined, { ...node.attrs, ...art });
          return true;
        },
    };
  },
  addProseMirrorPlugins: () => [equationPlugin],
});

export const EquationBlock = Node.create({
  name: EQUATION_BLOCK,
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      ...artAttributes(),
      id: {
        default: null,
        parseHTML: (element) => equationId(element.getAttribute("data-id")) ?? newEquationId(),
        renderHTML: (attributes) => (equationId(attributes.id) ? { "data-id": attributes.id } : {}),
      },
    };
  },
  parseHTML: () => [{ tag: "div[data-equation-block]" }],
  renderHTML: ({ node, HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { class: "vp-eq-block", "data-equation-block": "" }), picture(node, false)],
  renderText: () => "",
  addCommands() {
    return {
      insertEquationBlock:
        (art) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { ...art, id: newEquationId() } }),
    };
  },
});

export const EquationRef = Node.create({
  name: EQUATION_REF,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      target: {
        default: "",
        parseHTML: (element) => equationId(element.getAttribute("data-equation-ref")) ?? "",
        renderHTML: (attributes) => ({ "data-equation-ref": equationId(attributes.target) ?? "" }),
      },
    };
  },
  parseHTML: () => [{ tag: "span[data-equation-ref]", priority: 100 }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { class: "vp-eqref" })],
  renderText: () => "",
  addCommands() {
    return {
      insertEquationRef:
        (id) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { target: id } }),
    };
  },
});

export const equationNodes = (): AnyExtension[] => [Equation, EquationBlock, EquationRef];
