import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { BIBLIOGRAPHY, CITATION, citationItems, type CitationItem } from "./citationItems";
import type { Citations } from "./citations";
import { FOOTNOTE, footnoteCitations, footnoteMarkup } from "./footnotes";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    citation: { insertCitation: (items: CitationItem[]) => ReturnType };
    bibliography: { insertBibliography: () => ReturnType };
  }
}

export type CitationSource = {
  current: () => Citations;
  title: () => string;
  emptyText: string;
  subscribe: (listener: () => void) => () => void;
};

function readItems(element: HTMLElement): CitationItem[] {
  try {
    return citationItems(JSON.parse(element.getAttribute("data-citation") ?? "[]"));
  } catch {
    return [];
  }
}

const ordinals = new WeakMap<ProseNode, Map<number, number>>();

function ordinalAt(doc: ProseNode, position: number): number | undefined {
  let known = ordinals.get(doc);
  if (!known) {
    const found = new Map<number, number>();
    let count = 0;
    doc.descendants((node, at) => {
      if (node.type.name === CITATION) found.set(at, count++);
      else if (node.type.name === FOOTNOTE) count += footnoteCitations(footnoteMarkup(node.attrs.html)).length;
    });
    ordinals.set(doc, found);
    known = found;
  }
  return known.get(position);
}

export function citationNodes(source: CitationSource, inNote = false) {
  const Citation = Node.create({
    name: CITATION,
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    addAttributes() {
      return {
        items: {
          default: [],
          parseHTML: readItems,
          renderHTML: (attributes) => ({ "data-citation": JSON.stringify(citationItems(attributes.items)) }),
        },
      };
    },
    parseHTML: () => [{ tag: "span[data-citation]" }],
    renderHTML: ({ HTMLAttributes, node }) => ["span", mergeAttributes(HTMLAttributes, { class: "vp-cite" }), source.current().label(citationItems(node.attrs.items)).text],
    renderText: ({ node }) => source.current().label(citationItems(node.attrs.items)).text,
    addNodeView() {
      return ({ node, editor, getPos }) => {
        const dom = document.createElement("span");
        dom.className = "vp-cite";
        dom.contentEditable = "false";
        let current: ProseNode = node;
        const paint = () => {
          const items = citationItems(current.attrs.items);
          const citations = source.current();
          const position = inNote ? undefined : getPos();
          const label = citations.label(items, position === undefined ? undefined : ordinalAt(editor.state.doc, position), inNote);
          const note = citations.notes && !inNote;
          dom.toggleAttribute("data-note", note);
          if (note) {
            dom.textContent = "";
            dom.title = label.text;
          } else {
            dom.innerHTML = label.html;
            dom.title = items.map((item) => item.key).join(", ");
          }
          dom.toggleAttribute("data-missing", label.missing);
        };
        paint();
        const stop = source.subscribe(paint);
        return {
          dom,
          update: (next) => {
            if (next.type !== current.type) return false;
            current = next;
            paint();
            return true;
          },
          destroy: stop,
        };
      };
    },
    addCommands() {
      return {
        insertCitation:
          (items) =>
          ({ commands }) =>
            items.length > 0 && commands.insertContent({ type: this.name, attrs: { items: citationItems(items) } }),
      };
    },
  });

  const Bibliography = Node.create({
    name: BIBLIOGRAPHY,
    group: "block",
    atom: true,
    selectable: true,
    parseHTML: () => [{ tag: "div[data-bibliography]" }],
    renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { "data-bibliography": "", class: "vp-refs" })],
    addNodeView() {
      return () => {
        const dom = document.createElement("div");
        dom.className = "vp-refs";
        dom.contentEditable = "false";
        dom.setAttribute("data-bibliography", "");
        let painted = "";
        const paint = () => {
          const title = source.title();
          const references = source.current().references;
          const signature = JSON.stringify([title, references]);
          if (signature === painted) return;
          painted = signature;
          const heading = document.createElement("h1");
          heading.textContent = title;
          const rows = references.map((reference) => {
            const row = document.createElement("p");
            row.className = "vp-ref";
            row.innerHTML = reference;
            return row;
          });
          if (rows.length === 0) {
            const empty = document.createElement("p");
            empty.className = "vp-refs-empty";
            empty.textContent = source.emptyText;
            rows.push(empty);
          }
          dom.replaceChildren(heading, ...rows);
        };
        paint();
        const stop = source.subscribe(paint);
        return { dom, destroy: stop };
      };
    },
    addCommands() {
      return {
        insertBibliography:
          () =>
          ({ commands }) =>
            commands.insertContent({ type: this.name }),
      };
    },
  });

  return [Citation, Bibliography];
}
