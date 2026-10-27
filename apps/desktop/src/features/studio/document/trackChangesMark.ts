import { Extension, Mark, mergeAttributes, type AnyExtension } from "@tiptap/core";
import { isHistoryTransaction } from "@tiptap/pm/history";
import type { Fragment, Mark as ProseMark, MarkType, Node as ProseNode, Slice } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { ReplaceStep, type StepMap } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { authorTone, changeAttrs, changeId, changeKind, DELETION, INSERTION, newChangeId, TRACKING_ATTRIBUTE, type ChangeAttrs, type ChangeRange, type TrackedChange } from "./trackChanges";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    trackChanges: {
      setTrackChanges: (on: boolean) => ReturnType;
      acceptChange: (id: string) => ReturnType;
      rejectChange: (id: string) => ReturnType;
      acceptAllChanges: (authors?: string[]) => ReturnType;
      rejectAllChanges: (authors?: string[]) => ReturnType;
      selectChange: (id: string) => ReturnType;
      setActiveChange: (id: string | null) => ReturnType;
    };
  }
}

type ChangeType = ChangeRange["type"];
type Run = ChangeRange & { attrs: ChangeAttrs; text: string };
type Span = { from: number; to: number };
type TrackState = { active: string | null; decorations: DecorationSet };
type Pending =
  | { kind: "insert"; from: number; to: number; id: string; paired: boolean }
  | { kind: "delete"; at: number; slice: Slice; id: string; paired: boolean; backward: boolean };

const SKIP = "trackChangesSkip";
const KINDS: Record<ChangeType, string> = { [INSERTION]: "insert", [DELETION]: "delete" };

export const trackKey = new PluginKey<TrackState>("documentTrackChanges");

export function isTracking(doc: ProseNode): boolean {
  return doc.attrs[TRACKING_ATTRIBUTE] === true;
}

function changeType(mark: ProseMark): ChangeType | null {
  const name = mark.type.name;
  return name === INSERTION || name === DELETION ? name : null;
}

export function changeRuns(doc: ProseNode): Run[] {
  const runs: Run[] = [];
  const latest = new Map<string, Run>();
  doc.descendants((node, position) => {
    if (!node.isInline) return true;
    for (const mark of node.marks) {
      const type = changeType(mark);
      const attrs = type ? changeAttrs(mark.attrs) : null;
      if (!type || !attrs) continue;
      const key = `${type}:${attrs.id}`;
      const text = node.isText ? (node.text ?? "") : "";
      const last = latest.get(key);
      if (last && last.to === position) {
        last.to = position + node.nodeSize;
        last.text += text;
      } else {
        const run = { type, from: position, to: position + node.nodeSize, attrs, text };
        runs.push(run);
        latest.set(key, run);
      }
    }
    return false;
  });
  return runs;
}

export function trackedChanges(doc: ProseNode): TrackedChange[] {
  const byId = new Map<string, TrackedChange>();
  for (const run of changeRuns(doc)) {
    const range = { type: run.type, from: run.from, to: run.to };
    const found = byId.get(run.attrs.id);
    if (!found) {
      byId.set(run.attrs.id, { ...run.attrs, kind: "insert", from: run.from, to: run.to, inserted: run.type === INSERTION ? run.text : "", deleted: run.type === DELETION ? run.text : "", ranges: [range] });
      continue;
    }
    found.from = Math.min(found.from, run.from);
    found.to = Math.max(found.to, run.to);
    found.ranges.push(range);
    if (run.type === INSERTION) found.inserted += run.text;
    else found.deleted += run.text;
  }
  const changes = [...byId.values()].map((change) => ({ ...change, kind: changeKind(change.inserted, change.deleted), ranges: change.ranges.sort((left, right) => left.from - right.from) }));
  return changes.sort((left, right) => left.from - right.from);
}

export function changeAuthors(changes: TrackedChange[]): string[] {
  return [...new Set(changes.map((change) => change.author))];
}

function spans(doc: ProseNode, ranges: Span[]): Span[] {
  const merged: Span[] = [];
  for (const range of [...ranges].sort((left, right) => left.from - right.from)) {
    const last = merged.at(-1);
    if (last && (range.from <= last.to || doc.textBetween(last.to, range.from, "", "x") === "")) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }
  return merged.map((span) => wholeBlocks(doc, span));
}

function wholeBlocks(doc: ProseNode, span: Span): Span {
  const $from = doc.resolve(span.from);
  const $to = doc.resolve(span.to);
  const whole = $from.depth === 1 && $to.depth === 1 && $from.parent.isTextblock && $to.parent.isTextblock && $from.parentOffset === 0 && $to.parentOffset === $to.parent.content.size;
  if (!whole) return span;
  const from = $from.before();
  const to = $to.after();
  return from > 0 || to < doc.content.size ? { from, to } : span;
}

function settle(tr: Transaction, changes: TrackedChange[], accept: boolean): void {
  const keep: ChangeType = accept ? INSERTION : DELETION;
  const doc = tr.doc;
  const dropped: Span[] = [];
  for (const change of changes) {
    for (const range of change.ranges) {
      if (range.type === keep) tr.removeMark(range.from, range.to, doc.type.schema.marks[keep]);
      else dropped.push(range);
    }
  }
  for (const span of spans(doc, dropped).reverse()) tr.delete(span.from, span.to);
  tr.setMeta(SKIP, true).setMeta(trackKey, { active: null });
}

function hasInline(fragment: Fragment, keep: (node: ProseNode) => boolean = () => true): boolean {
  let found = false;
  fragment.descendants((node) => {
    if (found) return false;
    if (node.isInline && keep(node)) found = true;
    return !found;
  });
  return found;
}

function hasBlockLeaf(fragment: Fragment): boolean {
  let found = false;
  fragment.descendants((node) => {
    if (found) return false;
    if (node.isBlock && (node.isLeaf || node.type.name === "table")) found = true;
    return !found;
  });
  return found;
}

function mapPending(item: Pending, map: StepMap): void {
  if (item.kind === "insert") {
    item.from = map.map(item.from, 1);
    item.to = map.map(item.to, -1);
  } else item.at = map.map(item.at, -1);
}

function neighbour(doc: ProseNode, from: number, to: number, type: MarkType, author: string): ChangeAttrs | null {
  const sides = [doc.resolve(from).nodeBefore, doc.resolve(to).nodeAfter];
  for (const node of sides) {
    const mark = node ? type.isInSet(node.marks) : undefined;
    const attrs = mark ? changeAttrs(mark.attrs) : null;
    if (attrs && attrs.author === author) return attrs;
  }
  return null;
}

function inlineSpans(doc: ProseNode, from: number, to: number, keep: (node: ProseNode) => boolean): Span[] {
  const found: Span[] = [];
  doc.nodesBetween(from, to, (node, position) => {
    if (!node.isInline) return true;
    if (keep(node)) found.push({ from: Math.max(position, from), to: Math.min(position + node.nodeSize, to) });
    return false;
  });
  return found;
}

function collect(transactions: readonly Transaction[], old: EditorState): Pending[] {
  const pending: Pending[] = [];
  transactions.forEach((tr, trIndex) => {
    const counted = tr.docChanged && !tr.getMeta(SKIP) && !isHistoryTransaction(tr);
    tr.steps.forEach((step, index) => {
      const map = step.getMap();
      for (const item of pending) mapPending(item, map);
      if (!counted || !(step instanceof ReplaceStep)) return;
      const { from, to, slice } = step as unknown as { from: number; to: number; slice: Slice };
      const removed = tr.docs[index].slice(from, to);
      const deletes = to > from && hasInline(removed.content) && !hasBlockLeaf(removed.content);
      const inserts = slice.size > 0 && hasInline(slice.content);
      const id = newChangeId();
      const paired = deletes && inserts;
      const selection = trIndex === 0 && index === 0 ? old.selection : null;
      if (deletes) pending.push({ kind: "delete", at: map.map(from, -1), slice: removed, id, paired, backward: Boolean(selection?.empty && selection.head === to && !inserts) });
      if (inserts) pending.push({ kind: "insert", from: map.map(from, -1), to: map.map(to, 1), id, paired });
    });
  });
  return pending;
}

function track(transactions: readonly Transaction[], old: EditorState, state: EditorState, author: string): Transaction | null {
  if (!isTracking(state.doc) || !transactions.some((tr) => tr.docChanged && !tr.getMeta(SKIP) && !isHistoryTransaction(tr))) return null;
  const pending = collect(transactions, old);
  if (pending.length === 0) return null;
  const { insertion, deletion } = state.schema.marks;
  const date = new Date().toISOString();
  const own = (node: ProseNode) => node.marks.some((mark) => mark.type === insertion && mark.attrs.author === author);
  const out = state.tr;
  let cursor: { at: number; maps: number } | null = null;
  for (const item of pending) {
    if (item.kind !== "delete" || !hasInline(item.slice.content, (node) => !own(node))) continue;
    const at = out.mapping.map(item.at, -1);
    const size = out.doc.content.size;
    out.replace(at, at, item.slice);
    let end = at + out.doc.content.size - size;
    for (const span of inlineSpans(out.doc, at, end, own).reverse()) {
      out.delete(span.from, span.to);
      end -= span.to - span.from;
    }
    const attrs = (!item.paired && neighbour(out.doc, at, end, deletion, author)) || { id: item.id, author, date };
    for (const span of inlineSpans(out.doc, at, end, (node) => !deletion.isInSet(node.marks))) out.addMark(span.from, span.to, deletion.create(attrs));
    if (item.backward) cursor = { at, maps: out.mapping.maps.length };
  }
  for (const item of pending) {
    if (item.kind !== "insert") continue;
    const from = out.mapping.map(item.from, 1);
    const to = out.mapping.map(item.to, -1);
    if (from >= to) continue;
    out.removeMark(from, to, deletion);
    const attrs = (!item.paired && neighbour(out.doc, from, to, insertion, author)) || { id: item.id, author, date };
    out.addMark(from, to, insertion.create(attrs));
  }
  if (!out.docChanged) return null;
  if (cursor) out.setSelection(TextSelection.create(out.doc, out.mapping.slice(cursor.maps).map(cursor.at, -1)));
  return out.setMeta(SKIP, true);
}

function decorate(doc: ProseNode, active: string | null): DecorationSet {
  const runs = changeRuns(doc);
  if (runs.length === 0) return DecorationSet.empty;
  const authors = [...new Set(runs.map((run) => run.attrs.author))];
  const found: Decoration[] = [];
  const blocks = new Set<number>();
  for (const run of runs) {
    const classes = [run.type === INSERTION ? "vp-change-ins" : "vp-change-del", `vp-change-tone-${authorTone(authors, run.attrs.author)}`];
    if (run.attrs.id === active) classes.push("vp-change-active");
    found.push(Decoration.inline(run.from, run.to, { class: classes.join(" ") }));
    const $from = doc.resolve(run.from);
    if ($from.depth > 0 && $from.parent.isTextblock) {
      const start = $from.before();
      if (!blocks.has(start)) {
        blocks.add(start);
        found.push(Decoration.node(start, start + $from.parent.nodeSize, { class: "vp-changed" }));
      }
    }
  }
  return DecorationSet.create(doc, found);
}

function activeStill(doc: ProseNode, active: string, head: number): boolean {
  return changeRuns(doc).some((run) => run.attrs.id === active && head >= run.from && head <= run.to);
}

function trackPlugin(author: () => string): Plugin<TrackState> {
  return new Plugin<TrackState>({
    key: trackKey,
    state: {
      init: (_config, state) => ({ active: null, decorations: decorate(state.doc, null) }),
      apply: (tr, value, _old, state) => {
        const meta = tr.getMeta(trackKey) as { active: string | null } | undefined;
        let active = value.active;
        if (meta) active = meta.active;
        else if (tr.docChanged && !tr.getMeta(SKIP)) active = null;
        else if (active && tr.selectionSet && !activeStill(state.doc, active, state.selection.head)) active = null;
        if (active && !changeRuns(state.doc).some((run) => run.attrs.id === active)) active = null;
        if (!tr.docChanged && active === value.active) return value;
        return { active, decorations: decorate(state.doc, active) };
      },
    },
    props: {
      decorations: (state) => trackKey.getState(state)?.decorations ?? DecorationSet.empty,
      handleClick: (view, _position, event) => {
        const target = event.target instanceof Element ? event.target.closest("[data-change-id]") : null;
        const id = changeId(target?.getAttribute("data-change-id"));
        if (id !== (trackKey.getState(view.state)?.active ?? null)) view.dispatch(view.state.tr.setMeta(trackKey, { active: id }));
        return false;
      },
    },
    appendTransaction: (transactions, old, state) => track(transactions, old, state, author()),
  });
}

function changeMark(name: ChangeType) {
  return Mark.create({
    name,
    inclusive: false,
    addAttributes() {
      return {
        id: { default: null, parseHTML: (element) => changeId(element.getAttribute("data-change-id")), renderHTML: (attributes) => ({ "data-change-id": changeId(attributes.id) ?? "" }) },
        author: { default: "", parseHTML: (element) => element.getAttribute("data-author") ?? "", renderHTML: (attributes) => ({ "data-author": typeof attributes.author === "string" ? attributes.author : "" }) },
        date: { default: "", parseHTML: (element) => element.getAttribute("data-date") ?? "", renderHTML: (attributes) => (typeof attributes.date === "string" && attributes.date ? { "data-date": attributes.date } : {}) },
      };
    },
    parseHTML: () => [{ tag: `span[data-change="${KINDS[name]}"]` }],
    renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { "data-change": KINDS[name], class: name === INSERTION ? "vp-ins" : "vp-del" }), 0],
  });
}

export const Insertion = changeMark(INSERTION);
export const Deletion = changeMark(DELETION);

function pick(state: EditorState, authors?: string[]): TrackedChange[] {
  const changes = trackedChanges(state.doc);
  return authors ? changes.filter((change) => authors.includes(change.author)) : changes;
}

export const TrackChanges = Extension.create<{ author: () => string }>({
  name: "trackChanges",
  addOptions: () => ({ author: () => "" }),
  addGlobalAttributes: () => [{ types: ["doc"], attributes: { [TRACKING_ATTRIBUTE]: { default: false, rendered: false } } }],
  addKeyboardShortcuts() {
    return {
      Escape: () => {
        if (!trackKey.getState(this.editor.state)?.active) return false;
        return this.editor.commands.setActiveChange(null);
      },
    };
  },
  addCommands() {
    return {
      setTrackChanges:
        (on) =>
        ({ state, tr, dispatch }) => {
          if (isTracking(state.doc) === on) return false;
          if (dispatch) tr.setDocAttribute(TRACKING_ATTRIBUTE, on).setMeta(SKIP, true);
          return true;
        },
      acceptChange:
        (id) =>
        ({ state, tr, dispatch }) => {
          const change = trackedChanges(state.doc).find((item) => item.id === id);
          if (!change) return false;
          if (dispatch) settle(tr, [change], true);
          return true;
        },
      rejectChange:
        (id) =>
        ({ state, tr, dispatch }) => {
          const change = trackedChanges(state.doc).find((item) => item.id === id);
          if (!change) return false;
          if (dispatch) settle(tr, [change], false);
          return true;
        },
      acceptAllChanges:
        (authors) =>
        ({ state, tr, dispatch }) => {
          const changes = pick(state, authors);
          if (changes.length === 0) return false;
          if (dispatch) settle(tr, changes, true);
          return true;
        },
      rejectAllChanges:
        (authors) =>
        ({ state, tr, dispatch }) => {
          const changes = pick(state, authors);
          if (changes.length === 0) return false;
          if (dispatch) settle(tr, changes, false);
          return true;
        },
      selectChange:
        (id) =>
        ({ state, tr, dispatch }) => {
          const change = trackedChanges(state.doc).find((item) => item.id === id);
          if (!change) return false;
          if (dispatch) tr.setSelection(TextSelection.create(tr.doc, change.from)).setMeta(trackKey, { active: id }).scrollIntoView();
          return true;
        },
      setActiveChange:
        (id) =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(trackKey, { active: id });
          return true;
        },
    };
  },
  addProseMirrorPlugins() {
    return [trackPlugin(this.options.author)];
  },
});

export const trackChangesExtensions = (author: () => string): AnyExtension[] => [TrackChanges.configure({ author }), Insertion, Deletion];
