import { Extension, Mark, mergeAttributes, type AnyExtension } from "@tiptap/core";
import { isHistoryTransaction } from "@tiptap/pm/history";
import { Fragment, Slice, type Mark as ProseMark, type MarkType, type Node as ProseNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { canJoin, ReplaceStep, Transform, type Mapping, type StepMap } from "@tiptap/pm/transform";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import {
  authorTone,
  BREAK_ATTRIBUTE,
  BREAK_BLOCKS,
  BREAK_SIGN,
  breakChange,
  changeAttrs,
  changeId,
  changeKind,
  DELETION,
  INSERTION,
  ITEM_BLOCKS,
  newChangeId,
  TRACKING_ATTRIBUTE,
  type BreakChange,
  type ChangeAttrs,
  type ChangeRange,
  type ChangeType,
  type TrackedChange,
} from "./trackChanges";
import { useTrackChangesView } from "./trackChangesView";

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

type Run = ChangeRange & { attrs: ChangeAttrs; text: string };
type BreakRun = { type: ChangeType; pos: number; end: number; attrs: ChangeAttrs };
type Span = { from: number; to: number };
type TrackState = { active: string | null; decorations: DecorationSet };
type Pending =
  | { kind: "insert"; from: number; to: number; id: string; paired: boolean }
  | { kind: "delete"; at: number; slice: Slice; id: string; paired: boolean; backward: boolean }
  | { kind: "shape"; first: number; last: number; survivor: unknown; id: string };
type BreakMark = Span & { type: ChangeType; attrs: ChangeAttrs; covered: boolean; maps: number };

const SKIP = "trackChangesSkip";
const FLUSH = "trackChangesFlush";
const COMPOSE_SETTLE = 50;
const KINDS: Record<ChangeType, string> = { [INSERTION]: "insert", [DELETION]: "delete" };
const TYPES: Record<string, ChangeType> = { insert: INSERTION, delete: DELETION };

export const trackKey = new PluginKey<TrackState>("documentTrackChanges");

export function isTracking(doc: ProseNode): boolean {
  return doc.attrs[TRACKING_ATTRIBUTE] === true;
}

function markType(mark: ProseMark): ChangeType | null {
  const name = mark.type.name;
  return name === INSERTION || name === DELETION ? name : null;
}

function isDeleted(node: ProseNode): boolean {
  return node.marks.some((mark) => mark.type.name === DELETION);
}

export function changeRuns(doc: ProseNode): Run[] {
  const runs: Run[] = [];
  const latest = new Map<string, Run>();
  doc.descendants((node, position) => {
    if (!node.isInline) return true;
    for (const mark of node.marks) {
      const type = markType(mark);
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

export function changeBreaks(doc: ProseNode): BreakRun[] {
  const found: BreakRun[] = [];
  doc.descendants((node, position) => {
    if (node.isInline) return false;
    if (!node.isTextblock) return true;
    const value = BREAK_BLOCKS.has(node.type.name) ? breakChange(node.attrs[BREAK_ATTRIBUTE]) : null;
    if (value) found.push({ type: value.type, pos: position, end: position + node.nodeSize - 1, attrs: { id: value.id, author: value.author, date: value.date } });
    return false;
  });
  return found;
}

export function trackedChanges(doc: ProseNode): TrackedChange[] {
  const entries = [...changeRuns(doc).map((run) => ({ ...run, pos: -1 })), ...changeBreaks(doc).map((item) => ({ type: item.type, from: item.end, to: item.end, attrs: item.attrs, text: BREAK_SIGN, pos: item.pos }))];
  entries.sort((left, right) => left.from - right.from);
  const byId = new Map<string, TrackedChange>();
  for (const entry of entries) {
    let found = byId.get(entry.attrs.id);
    if (!found) {
      found = { ...entry.attrs, kind: "insert", from: entry.from, to: entry.to, inserted: "", deleted: "", ranges: [], breaks: [] };
      byId.set(entry.attrs.id, found);
    }
    found.from = Math.min(found.from, entry.from);
    found.to = Math.max(found.to, entry.to);
    if (entry.pos >= 0) found.breaks.push({ type: entry.type, pos: entry.pos });
    else found.ranges.push({ type: entry.type, from: entry.from, to: entry.to });
    if (entry.type === INSERTION) found.inserted += entry.text;
    else found.deleted += entry.text;
  }
  const changes = [...byId.values()].map((change) => ({ ...change, kind: changeKind(change.inserted, change.deleted) }));
  return changes.sort((left, right) => left.from - right.from);
}

export function changeAuthors(changes: TrackedChange[]): string[] {
  return [...new Set(changes.map((change) => change.author))];
}

export function finalDocument(doc: ProseNode): { doc: ProseNode; mapping: Mapping } {
  const transform = new Transform(doc);
  const spans: Span[] = [];
  doc.descendants((node, position) => {
    if (!node.isInline) return true;
    if (isDeleted(node)) spans.push({ from: position, to: position + node.nodeSize });
    return false;
  });
  for (const span of spans.reverse()) transform.delete(span.from, span.to);
  return { doc: transform.doc, mapping: transform.mapping };
}

function joinsNext(doc: ProseNode, pos: number): boolean {
  const node = doc.nodeAt(pos);
  if (!node) return false;
  const next = doc.resolve(pos + node.nodeSize).nodeAfter;
  if (next && BREAK_BLOCKS.has(next.type.name)) return true;
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  if (!ITEM_BLOCKS.has(parent.type.name) || $pos.index() !== parent.childCount - 1) return false;
  const item = doc.resolve($pos.after()).nodeAfter;
  return Boolean(item && item.type === parent.type && item.firstChild && BREAK_BLOCKS.has(item.firstChild.type.name));
}

function removable(doc: ProseNode, pos: number): boolean {
  const $pos = doc.resolve(pos);
  if ($pos.parent.childCount > 1) return true;
  return ITEM_BLOCKS.has($pos.parent.type.name) && $pos.node(-1).childCount > 1;
}

function setBreak(tr: Transaction, pos: number, value: unknown): void {
  const node = tr.doc.nodeAt(pos);
  if (!node || !BREAK_BLOCKS.has(node.type.name)) return;
  const next = breakChange(value);
  const stored = node.attrs[BREAK_ATTRIBUTE];
  if (next === null ? stored === null : JSON.stringify(next) === JSON.stringify(breakChange(stored))) return;
  tr.setNodeAttribute(pos, BREAK_ATTRIBUTE, next);
}

function settleBreak(tr: Transaction, pos: number): void {
  const node = tr.doc.nodeAt(pos);
  if (!node || !BREAK_BLOCKS.has(node.type.name)) return;
  const $pos = tr.doc.resolve(pos);
  const parent = $pos.parent;
  if (node.content.size === 0) {
    if (parent.childCount > 1) {
      tr.delete(pos, pos + node.nodeSize);
      return;
    }
    if (ITEM_BLOCKS.has(parent.type.name) && $pos.node(-1).childCount > 1) {
      const item = $pos.before();
      tr.delete(item, item + parent.nodeSize);
      return;
    }
  }
  const after = pos + node.nodeSize;
  const next = tr.doc.resolve(after).nodeAfter;
  if (next && BREAK_BLOCKS.has(next.type.name) && canJoin(tr.doc, after)) {
    const survivor = next.attrs[BREAK_ATTRIBUTE];
    tr.join(after);
    setBreak(tr, pos, survivor);
    return;
  }
  if (ITEM_BLOCKS.has(parent.type.name) && $pos.index() === parent.childCount - 1) {
    const end = $pos.after();
    const item = tr.doc.resolve(end).nodeAfter;
    const head = item?.firstChild;
    if (item && item.type === parent.type && head && BREAK_BLOCKS.has(head.type.name)) {
      const survivor = head.attrs[BREAK_ATTRIBUTE];
      tr.delete(after - 1, end + 2);
      setBreak(tr, pos, survivor);
      return;
    }
  }
  setBreak(tr, pos, null);
}

function settle(tr: Transaction, changes: TrackedChange[], accept: boolean): void {
  const keep: ChangeType = accept ? INSERTION : DELETION;
  const base = tr.steps.length;
  const dropped: Span[] = [];
  const breaks: number[] = [];
  for (const change of changes) {
    for (const range of change.ranges) {
      if (range.type === keep) tr.removeMark(range.from, range.to, tr.doc.type.schema.marks[keep]);
      else dropped.push(range);
    }
    for (const item of change.breaks) {
      if (item.type === keep) setBreak(tr, item.pos, null);
      else breaks.push(item.pos);
    }
  }
  const mapped = (pos: number, assoc: number) => tr.mapping.slice(base).map(pos, assoc);
  for (const span of dropped.sort((left, right) => right.from - left.from)) tr.delete(mapped(span.from, 1), mapped(span.to, -1));
  for (const pos of [...new Set(breaks)].sort((left, right) => right - left)) settleBreak(tr, mapped(pos, 1));
  tr.setMeta(SKIP, true).setMeta(trackKey, { active: null });
}

function looseInline(fragment: Fragment, openStart: number, openEnd: number, keep: (node: ProseNode) => boolean = () => true): boolean {
  let found = false;
  fragment.forEach((node, _offset, index) => {
    if (found) return;
    const left = index === 0 ? openStart : 0;
    const right = index === fragment.childCount - 1 ? openEnd : 0;
    if (node.isInline) found = keep(node);
    else if (!(node.type.name === "table" && left === 0 && right === 0)) found = looseInline(node.content, Math.max(0, left - 1), Math.max(0, right - 1), keep);
  });
  return found;
}

function sliceInline(slice: Slice, keep?: (node: ProseNode) => boolean): boolean {
  return looseInline(slice.content, slice.openStart, slice.openEnd, keep);
}

function mapPending(item: Pending, map: StepMap | Mapping): void {
  if (item.kind === "insert") {
    item.from = map.map(item.from, 1);
    item.to = map.map(item.to, -1);
  } else if (item.kind === "delete") item.at = map.map(item.at, -1);
  else {
    item.first = map.map(item.first, -1);
    item.last = map.map(item.last, 1);
  }
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
    if (node.type.name === "table" && position >= from && position + node.nodeSize <= to) return false;
    if (!node.isInline) return true;
    if (keep(node)) found.push({ from: Math.max(position, from), to: Math.min(position + node.nodeSize, to) });
    return false;
  });
  return found;
}

function blockAt(doc: ProseNode, pos: number): number | null {
  if (pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);
  return $pos.parent.isTextblock && BREAK_BLOCKS.has($pos.parent.type.name) ? $pos.before() : null;
}

function counted(tr: Transaction): boolean {
  return tr.docChanged && !tr.getMeta(SKIP) && !isHistoryTransaction(tr);
}

function collect(transactions: readonly Transaction[], old: EditorState, tracking: boolean): Pending[] {
  const pending: Pending[] = [];
  transactions.forEach((tr, trIndex) => {
    const live = counted(tr);
    tr.steps.forEach((step, index) => {
      const map = step.getMap();
      for (const item of pending) mapPending(item, map);
      if (!live || !(step instanceof ReplaceStep)) return;
      const { from, to, slice } = step as unknown as { from: number; to: number; slice: Slice };
      const before = tr.docs[index];
      const after = tr.docs[index + 1] ?? tr.doc;
      const id = newChangeId();
      const $from = before.resolve(from);
      const $to = before.resolve(to);
      const first = map.map(from, -1);
      const last = map.map(to, 1);
      const crossed = $from.parent !== $to.parent || blockAt(after, first) !== blockAt(after, last);
      if (crossed && $to.parent.isTextblock && BREAK_BLOCKS.has($to.parent.type.name)) pending.push({ kind: "shape", first, last, survivor: $to.parent.attrs[BREAK_ATTRIBUTE], id });
      else if (crossed) pending.push({ kind: "shape", first, last, survivor: undefined, id });
      if (!tracking) return;
      const removed = before.slice(from, to);
      const deletes = to > from && sliceInline(removed);
      const inserts = slice.size > 0 && sliceInline(slice);
      const paired = deletes && inserts;
      const selection = trIndex === 0 && index === 0 ? old.selection : null;
      if (deletes) pending.push({ kind: "delete", at: map.map(from, -1), slice: removed, id, paired, backward: Boolean(selection?.empty && selection.head === to && !inserts) });
      if (inserts) pending.push({ kind: "insert", from: map.map(from, -1), to: map.map(to, 1), id, paired });
    });
  });
  return pending;
}

function composed(held: ProseNode, doc: ProseNode): Pending[] {
  const start = held.content.findDiffStart(doc.content);
  const end = held.content.findDiffEnd(doc.content);
  if (start === null || !end) return [];
  let { a, b } = end;
  const overlap = start - Math.min(a, b);
  if (overlap > 0) {
    a += overlap;
    b += overlap;
  }
  const removed = held.slice(start, a);
  const deletes = a > start && sliceInline(removed);
  const inserts = b > start && sliceInline(doc.slice(start, b));
  const id = newChangeId();
  const pending: Pending[] = [];
  if (deletes) pending.push({ kind: "delete", at: start, slice: removed, id, paired: deletes && inserts, backward: false });
  if (inserts) pending.push({ kind: "insert", from: start, to: b, id, paired: deletes && inserts });
  return pending;
}

function breakMarks(doc: ProseNode, mark: BreakMark): Array<{ pos: number; value: BreakChange }> {
  const found: Array<{ pos: number; value: BreakChange }> = [];
  doc.nodesBetween(mark.from, mark.to, (node, position) => {
    if (node.type.name === "table" && position >= mark.from && position + node.nodeSize <= mark.to) return false;
    if (!node.isTextblock) return true;
    if (!BREAK_BLOCKS.has(node.type.name)) return false;
    const start = position + 1;
    const end = position + node.nodeSize - 1;
    const crossed = mark.from <= end && end < mark.to;
    const covered = mark.covered && mark.from <= start && end <= mark.to && end > start;
    if ((crossed && joinsNext(doc, position)) || (covered && removable(doc, position))) found.push({ pos: position, value: { type: mark.type, ...mark.attrs } });
    return false;
  });
  return found;
}

function track(transactions: readonly Transaction[], old: EditorState, state: EditorState, author: string, held: ProseNode | null): Transaction | null {
  const tracking = isTracking(state.doc);
  const pending = held && tracking ? composed(held, state.doc) : collect(transactions, old, tracking);
  if (pending.length === 0) return null;
  const { insertion, deletion } = state.schema.marks;
  const date = new Date().toISOString();
  const own = (node: ProseNode) => node.marks.some((mark) => mark.type === insertion && mark.attrs.author === author);
  const out = state.tr;
  const kept = new Set<string>();
  const marks: BreakMark[] = [];
  let cursor: { at: number; maps: number } | null = null;
  for (const item of pending) {
    if (item.kind !== "delete" || !sliceInline(item.slice, (node) => !own(node))) continue;
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
    kept.add(item.id);
    marks.push({ from: at, to: end, type: DELETION, attrs, covered: true, maps: out.mapping.maps.length });
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
    kept.add(item.id);
    marks.push({ from, to, type: INSERTION, attrs, covered: false, maps: out.mapping.maps.length });
  }
  for (const item of pending) {
    if (item.kind !== "shape") continue;
    const last = blockAt(out.doc, out.mapping.map(item.last, 1));
    const first = blockAt(out.doc, out.mapping.map(item.first, -1));
    if (last !== null && item.survivor !== undefined) setBreak(out, last, item.survivor);
    if (first !== null && first !== last && !kept.has(item.id)) setBreak(out, first, null);
  }
  for (const mark of marks) {
    const shifted = out.mapping.slice(mark.maps);
    for (const found of breakMarks(out.doc, { ...mark, from: shifted.map(mark.from, -1), to: shifted.map(mark.to, 1) })) setBreak(out, found.pos, found.value);
  }
  if (!out.docChanged) return null;
  if (cursor) out.setSelection(TextSelection.create(out.doc, out.mapping.slice(cursor.maps).map(cursor.at, -1)));
  return out.setMeta(SKIP, true);
}

function pastedFragment(fragment: Fragment, fresh: (id: string) => string): Fragment {
  const nodes: ProseNode[] = [];
  fragment.forEach((node) => {
    if (node.isInline && isDeleted(node)) return;
    const marks = node.marks.map((mark) => (mark.type.name === INSERTION && changeId(mark.attrs.id) ? mark.type.create({ ...mark.attrs, id: fresh(mark.attrs.id as string) }) : mark));
    if (node.isText) {
      nodes.push(node.mark(marks));
      return;
    }
    const value = breakChange(node.attrs[BREAK_ATTRIBUTE]);
    const attrs = BREAK_ATTRIBUTE in node.attrs ? { ...node.attrs, [BREAK_ATTRIBUTE]: value?.type === INSERTION ? { ...value, id: fresh(value.id) } : null } : node.attrs;
    nodes.push(node.type.create(attrs, pastedFragment(node.content, fresh), marks));
  });
  return Fragment.from(nodes);
}

export function pastedSlice(slice: Slice): Slice {
  const ids = new Map<string, string>();
  const fresh = (id: string) => {
    const known = ids.get(id);
    if (known) return known;
    const made = newChangeId();
    ids.set(id, made);
    return made;
  };
  return new Slice(pastedFragment(slice.content, fresh), slice.openStart, slice.openEnd);
}

function breakWidget(className: string, id: string): () => HTMLElement {
  return () => {
    const sign = document.createElement("span");
    sign.className = className;
    sign.textContent = BREAK_SIGN;
    sign.setAttribute("data-change-id", id);
    sign.setAttribute("aria-hidden", "true");
    sign.contentEditable = "false";
    return sign;
  };
}

function decorate(doc: ProseNode, active: string | null): DecorationSet {
  const runs = changeRuns(doc);
  const breaks = changeBreaks(doc);
  if (runs.length === 0 && breaks.length === 0) return DecorationSet.empty;
  const authors = [...new Set([...runs, ...breaks].map((run) => run.attrs.author))];
  const found: Decoration[] = [];
  const blocks = new Set<number>();
  const changedBlock = (start: number, size: number) => {
    if (blocks.has(start)) return;
    blocks.add(start);
    found.push(Decoration.node(start, start + size, { class: "vp-changed" }));
  };
  const classes = (type: ChangeType, attrs: ChangeAttrs) => [type === INSERTION ? "vp-change-ins" : "vp-change-del", `vp-change-tone-${authorTone(authors, attrs.author)}`, ...(attrs.id === active ? ["vp-change-active"] : [])];
  for (const run of runs) {
    found.push(Decoration.inline(run.from, run.to, { class: classes(run.type, run.attrs).join(" ") }));
    const $from = doc.resolve(run.from);
    if ($from.depth > 0 && $from.parent.isTextblock) changedBlock($from.before(), $from.parent.nodeSize);
  }
  for (const item of breaks) {
    const className = ["vp-break-mark", ...classes(item.type, item.attrs)].join(" ");
    found.push(Decoration.widget(item.end, breakWidget(className, item.attrs.id), { side: 1, ignoreSelection: true, key: `${className}:${item.attrs.id}` }));
    changedBlock(item.pos, item.end + 1 - item.pos);
  }
  return DecorationSet.create(doc, found);
}

function activeStill(doc: ProseNode, active: string, head: number): boolean {
  return changeRuns(doc).some((run) => run.attrs.id === active && head >= run.from && head <= run.to) || changeBreaks(doc).some((item) => item.attrs.id === active && head === item.end);
}

function trackPlugin(author: () => string): Plugin<TrackState> {
  let current: EditorView | null = null;
  let held: ProseNode | null = null;
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
        if (active && !trackedChanges(state.doc).some((change) => change.id === active)) active = null;
        if (!tr.docChanged && active === value.active) return value;
        return { active, decorations: decorate(state.doc, active) };
      },
    },
    view: (view) => {
      current = view;
      const stop = useTrackChangesView.subscribe((next, previous) => {
        if (next.view !== previous.view && !view.isDestroyed) view.dispatch(view.state.tr.setMeta(trackKey, { active: null }));
      });
      return {
        destroy: () => {
          stop();
          current = null;
        },
      };
    },
    props: {
      decorations: (state) => trackKey.getState(state)?.decorations ?? DecorationSet.empty,
      editable: () => useTrackChangesView.getState().view === "markup",
      transformPasted: (slice) => pastedSlice(slice),
      handleClick: (view, _position, event) => {
        const target = event.target instanceof Element ? event.target.closest("[data-change-id]") : null;
        const id = changeId(target?.getAttribute("data-change-id"));
        if (id !== (trackKey.getState(view.state)?.active ?? null)) view.dispatch(view.state.tr.setMeta(trackKey, { active: id }));
        return false;
      },
      handleDOMEvents: {
        compositionend: (view) => {
          window.setTimeout(() => {
            if (held && !view.isDestroyed && !view.composing) view.dispatch(view.state.tr.setMeta(FLUSH, true));
          }, COMPOSE_SETTLE);
          return false;
        },
      },
    },
    appendTransaction: (transactions, old, state) => {
      const flush = transactions.some((tr) => tr.getMeta(FLUSH));
      if (!flush && !transactions.some(counted)) return null;
      if (current?.composing && isTracking(state.doc)) {
        held ??= old.doc;
        return null;
      }
      const start = held;
      held = null;
      return track(transactions, old, state, author(), start);
    },
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

function parsedBreak(element: HTMLElement): BreakChange | null {
  return breakChange({ type: TYPES[element.getAttribute("data-break-change") ?? ""], id: element.getAttribute("data-break-id"), author: element.getAttribute("data-break-author") ?? "", date: element.getAttribute("data-break-date") ?? "" });
}

function renderedBreak(value: unknown): Record<string, string> {
  const change = breakChange(value);
  if (!change) return {};
  return { "data-break-change": KINDS[change.type], "data-break-id": change.id, "data-break-author": change.author, ...(change.date ? { "data-break-date": change.date } : {}) };
}

export const TrackChanges = Extension.create<{ author: () => string }>({
  name: "trackChanges",
  addOptions: () => ({ author: () => "" }),
  addGlobalAttributes: () => [
    { types: ["doc"], attributes: { [TRACKING_ATTRIBUTE]: { default: false, rendered: false } } },
    { types: [...BREAK_BLOCKS], attributes: { [BREAK_ATTRIBUTE]: { default: null, keepOnSplit: false, parseHTML: parsedBreak, renderHTML: (attributes) => renderedBreak(attributes[BREAK_ATTRIBUTE]) } } },
  ],
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
