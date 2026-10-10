// vivePDF Studio document editor (iOS). A contenteditable surface that mirrors the desktop TipTap
// schema: the DOM is serialised to the same ProseMirror JSON (`doc`, `paragraph`, `heading`, lists,
// task lists, tables, images, page breaks, marks with textStyle attributes) and posted to Swift.
(function () {
  "use strict";
  const editor = document.getElementById("editor");
  const paper = document.getElementById("paper");
  const post = (message) => { try { window.webkit.messageHandlers.vp.postMessage(message); } catch (e) {} };
  const BLOCK_TAGS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "HR", "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH", "DIV", "FIGURE", "SECTION", "ARTICLE", "HEADER", "FOOTER", "NAV", "ASIDE", "MAIN", "DL", "DT", "DD", "IMG"]);
  const ALIGNS = new Set(["left", "center", "right", "justify"]);
  const COLOUR = /^#[0-9a-f]{6}$/i;
  let bodyFont = "";
  let placeholder = "";

  // ---------- helpers ----------
  function hex(value) {
    if (!value) return null;
    value = String(value).trim();
    if (COLOUR.test(value)) return value.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(value)) return ("#" + value.slice(1).split("").map((c) => c + c).join("")).toLowerCase();
    const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/i.exec(value);
    if (m) {
      if (m[4] !== undefined && Number(m[4]) === 0) return null;
      return "#" + [m[1], m[2], m[3]].map((n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, "0")).join("");
    }
    return null;
  }
  function isBlock(node) { return node.nodeType === 1 && BLOCK_TAGS.has(node.tagName); }
  function isPageBreak(node) { return node.nodeType === 1 && node.tagName === "DIV" && (node.hasAttribute("data-page-break") || node.classList.contains("page-break")); }
  function closest(node, test) {
    while (node && node !== editor) { if (node.nodeType === 1 && test(node)) return node; node = node.parentNode; }
    return null;
  }
  function selectionRange() {
    const selection = window.getSelection();
    if (!selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    return editor.contains(range.commonAncestorContainer) ? range : null;
  }
  function anchorElement() {
    const range = selectionRange();
    if (!range) return null;
    let node = range.startContainer;
    if (node.nodeType === 3) node = node.parentNode;
    else if (node.childNodes[range.startOffset] && node.childNodes[range.startOffset].nodeType === 1 && range.collapsed) node = node.childNodes[range.startOffset] || node;
    return node;
  }
  function blockOf(node) { return closest(node, (el) => /^(P|H[1-6]|PRE|LI|TD|TH)$/.test(el.tagName)); }

  // ---------- serialisation (DOM → ProseMirror JSON) ----------
  function cleanText(text, pre) { return pre ? text : text.replace(/[\n\r\t ]+/g, " "); }

  function marksOf(el, inherited) {
    let marks = inherited.slice();
    const add = (mark) => { marks = marks.filter((m) => m.type !== mark.type); marks.push(mark); };
    const tag = el.tagName;
    const style = el.style || {};
    if (tag === "STRONG" || tag === "B") { if (style.fontWeight !== "normal" && style.fontWeight !== "400") add({ type: "bold" }); }
    if (tag === "EM" || tag === "I") add({ type: "italic" });
    if (tag === "U" || tag === "INS") add({ type: "underline" });
    if (tag === "S" || tag === "STRIKE" || tag === "DEL") add({ type: "strike" });
    if (tag === "CODE") add({ type: "code" });
    if (tag === "SUB") add({ type: "subscript" });
    if (tag === "SUP") add({ type: "superscript" });
    if (tag === "A" && el.getAttribute("href")) add({ type: "link", attrs: { href: el.getAttribute("href"), target: "_blank", rel: "noopener noreferrer nofollow", class: null } });
    if (tag === "MARK") add({ type: "highlight", attrs: { color: hex(el.getAttribute("data-color")) || hex(style.backgroundColor) || null } });
    if (tag === "SPAN" || tag === "FONT") {
      const weight = style.fontWeight;
      if (weight === "bold" || Number(weight) >= 600) add({ type: "bold" });
      if (style.fontStyle === "italic") add({ type: "italic" });
      const decoration = (style.textDecoration || "") + " " + (style.textDecorationLine || "");
      if (/underline/.test(decoration)) add({ type: "underline" });
      if (/line-through/.test(decoration)) add({ type: "strike" });
      const current = marks.find((m) => m.type === "textStyle");
      const attrs = current ? Object.assign({}, current.attrs) : { color: null, backgroundColor: null, fontSize: null, fontId: null };
      let touched = false;
      const color = hex(style.color) || (tag === "FONT" ? hex(el.getAttribute("color")) : null);
      if (color) { attrs.color = color; touched = true; }
      const background = hex(style.backgroundColor);
      if (background) { attrs.backgroundColor = background; touched = true; }
      if (style.fontSize && /^[\d.]+(pt|px)$/.test(style.fontSize)) { attrs.fontSize = style.fontSize; touched = true; }
      if (el.hasAttribute("data-font-id")) { attrs.fontId = el.getAttribute("data-font-id") || null; touched = true; }
      if (touched) add({ type: "textStyle", attrs });
    }
    return marks;
  }

  function sameMarks(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  // Collects inline content; images split the paragraph (TipTap images are blocks).
  function inline(nodes, marks, out, pre) {
    for (const node of nodes) {
      if (node.nodeType === 3) {
        const text = cleanText(node.data, pre);
        if (!text) continue;
        const last = out.current[out.current.length - 1];
        const clean = marks.filter((m) => m.type !== "textStyle" || Object.values(m.attrs).some((v) => v !== null));
        if (last && last.type === "text" && sameMarks(last.marks || [], clean)) last.text += text;
        else out.current.push(clean.length ? { type: "text", text, marks: clean } : { type: "text", text });
      } else if (node.nodeType === 1) {
        if (node.tagName === "BR") { out.current.push({ type: "hardBreak" }); continue; }
        if (node.tagName === "IMG") { out.flush(); out.blocks.push(imageNode(node)); continue; }
        if (node.tagName === "LABEL" && node.getAttribute("contenteditable") === "false") continue;
        inline(node.childNodes, marksOf(node, marks), out, pre);
      }
    }
  }

  function trimInline(content) {
    while (content.length && content[content.length - 1].type === "hardBreak") content.pop();
    if (content.length && content[0].type === "text") { content[0].text = content[0].text.replace(/^ +/, ""); if (!content[0].text) content.shift(); }
    const last = content[content.length - 1];
    if (last && last.type === "text") { last.text = last.text.replace(/ +$/, ""); if (!last.text) content.pop(); }
    return content;
  }

  function align(el) { const value = el.style && el.style.textAlign; return ALIGNS.has(value) ? value : null; }

  function textBlock(el, type, attrs) {
    const blocks = [];
    const out = { current: [], blocks, flush() { if (this.current.length) { push(this.current); this.current = []; } } };
    let first = true;
    function push(content) {
      const node = { type, attrs: Object.assign({}, attrs) };
      const trimmed = trimInline(content);
      if (trimmed.length) node.content = trimmed;
      if (!first && type === "heading") { node.type = "paragraph"; node.attrs = { textAlign: attrs.textAlign }; }
      first = false;
      blocks.push(node);
    }
    inline(el.childNodes, [], out, false);
    if (out.current.length || !blocks.length) { const content = out.current; out.current = []; push(content); }
    return blocks;
  }

  function imageNode(img) {
    let width = Number(img.getAttribute("width")) || parseFloat(img.style.width) || null;
    const height = Number(img.getAttribute("height")) || null;
    return { type: "image", attrs: { src: img.getAttribute("src") || "", alt: img.getAttribute("alt"), title: img.getAttribute("title"), width: width ? Math.round(width) : null, height } };
  }

  function listItems(list, itemType) {
    const items = [];
    for (const child of list.childNodes) {
      if (child.nodeType !== 1) continue;
      if (child.tagName === "LI") {
        const node = { type: itemType };
        if (itemType === "taskItem") node.attrs = { checked: child.getAttribute("data-checked") === "true" };
        const holder = itemType === "taskItem" ? (child.querySelector(":scope > div") || child) : child;
        let content = blocks(holder.childNodes);
        if (!content.length || content[0].type !== "paragraph") content.unshift({ type: "paragraph", attrs: { textAlign: null } });
        node.content = content;
        items.push(node);
      } else if (child.tagName === "UL" || child.tagName === "OL") {
        // A list nested directly in a list belongs to the previous item.
        const nested = listNode(child);
        if (items.length) items[items.length - 1].content.push(nested);
        else items.push({ type: itemType, content: [{ type: "paragraph", attrs: { textAlign: null } }, nested] });
      }
    }
    return items;
  }

  function listNode(el) {
    if (el.getAttribute("data-type") === "taskList") return { type: "taskList", content: listItems(el, "taskItem") };
    if (el.tagName === "OL") {
      const start = Number(el.getAttribute("start")) || 1;
      return { type: "orderedList", attrs: { start, type: null }, content: listItems(el, "listItem") };
    }
    return { type: "bulletList", content: listItems(el, "listItem") };
  }

  function cellNode(cell) {
    const widths = (cell.getAttribute("data-colwidth") || "").split(",").map(Number).filter((n) => n > 0);
    let content = blocks(cell.childNodes);
    if (!content.length) content = [{ type: "paragraph", attrs: { textAlign: null } }];
    return { type: cell.tagName === "TH" ? "tableHeader" : "tableCell", attrs: { colspan: Number(cell.getAttribute("colspan")) || 1, rowspan: Number(cell.getAttribute("rowspan")) || 1, colwidth: widths.length ? widths : null }, content };
  }

  function tableNode(table) {
    const rows = [];
    for (const row of table.querySelectorAll("tr")) {
      if (row.closest("table") !== table) continue;
      const cells = Array.from(row.children).filter((c) => c.tagName === "TD" || c.tagName === "TH").map(cellNode);
      if (cells.length) rows.push({ type: "tableRow", content: cells });
    }
    return rows.length ? { type: "table", content: rows } : null;
  }

  function blocks(nodes) {
    const result = [];
    let pending = [];
    const flushInline = () => {
      if (!pending.length) return;
      const holder = document.createElement("p");
      pending.forEach((n) => holder.appendChild(n.cloneNode(true)));
      pending = [];
      if (!holder.textContent.trim() && !holder.querySelector("img,br")) return;
      result.push(...textBlock(holder, "paragraph", { textAlign: null }));
    };
    for (const node of nodes) {
      if (node.nodeType === 3) { if (node.data.trim() || pending.length) pending.push(node); continue; }
      if (node.nodeType !== 1) continue;
      if (!isBlock(node)) { pending.push(node); continue; }
      flushInline();
      const tag = node.tagName;
      if (isPageBreak(node)) result.push({ type: "pageBreak" });
      else if (tag === "P") result.push(...textBlock(node, "paragraph", { textAlign: align(node) }));
      else if (/^H[1-4]$/.test(tag)) result.push(...textBlock(node, "heading", { textAlign: align(node), level: Number(tag[1]) }));
      else if (/^H[56]$/.test(tag)) result.push(...textBlock(node, "paragraph", { textAlign: align(node) }));
      else if (tag === "UL" || tag === "OL") result.push(listNode(node));
      else if (tag === "BLOCKQUOTE") {
        let content = blocks(node.childNodes);
        if (!content.length) content = [{ type: "paragraph", attrs: { textAlign: null } }];
        result.push({ type: "blockquote", content });
      } else if (tag === "PRE") {
        const code = node.querySelector("code");
        const language = code && /language-([\w-]+)/.exec(code.className || "");
        const text = node.textContent.replace(/\n$/, "");
        const block = { type: "codeBlock", attrs: { language: language ? language[1] : null } };
        if (text) block.content = [{ type: "text", text }];
        result.push(block);
      } else if (tag === "HR") result.push({ type: "horizontalRule" });
      else if (tag === "IMG") result.push(imageNode(node));
      else if (tag === "TABLE") { const table = tableNode(node); if (table) result.push(table); }
      else if (tag === "LI") result.push(...blocks(node.childNodes));
      else {
        const hasBlocks = Array.from(node.childNodes).some(isBlock);
        if (hasBlocks) result.push(...blocks(node.childNodes));
        else result.push(...textBlock(node, "paragraph", { textAlign: align(node) }));
      }
    }
    flushInline();
    return result;
  }

  function serialize() {
    const content = blocks(editor.childNodes);
    if (!content.length) content.push({ type: "paragraph", attrs: { textAlign: null } });
    return { type: "doc", content };
  }

  // ---------- normalisation of loaded markup ----------
  function decorateTasks() {
    for (const li of editor.querySelectorAll('li[data-type="taskItem"]')) {
      let label = li.querySelector(":scope > label");
      if (!label) {
        label = document.createElement("label");
        label.setAttribute("contenteditable", "false");
        const box = document.createElement("input");
        box.type = "checkbox";
        label.appendChild(box);
        const holder = document.createElement("div");
        while (li.firstChild) holder.appendChild(li.firstChild);
        if (!holder.firstChild) holder.innerHTML = "<p><br></p>";
        li.appendChild(label);
        li.appendChild(holder);
      }
      label.querySelector("input").checked = li.getAttribute("data-checked") === "true";
    }
    for (const ul of editor.querySelectorAll('ul[data-type="taskList"]')) {
      for (const li of ul.children) if (li.tagName === "LI" && li.getAttribute("data-type") !== "taskItem") { li.setAttribute("data-type", "taskItem"); li.setAttribute("data-checked", "false"); }
    }
  }
  function decoratePageBreaks() {
    for (const el of editor.querySelectorAll("div[data-page-break], div.page-break")) { el.className = "page-break"; el.setAttribute("data-page-break", ""); el.setAttribute("contenteditable", "false"); el.innerHTML = ""; }
  }
  function decorate() {
    decorateTasks();
    decoratePageBreaks();
    for (const img of editor.querySelectorAll("img")) img.setAttribute("draggable", "false");
    if (!editor.firstChild) editor.innerHTML = "<p><br></p>";
    updatePlaceholder();
  }
  function updatePlaceholder() {
    const empty = editor.childNodes.length === 1 && editor.firstChild.nodeType === 1 && editor.firstChild.tagName === "P" && !editor.textContent && !editor.querySelector("img");
    editor.classList.toggle("is-empty", empty);
    editor.setAttribute("data-placeholder", placeholder);
  }

  // ---------- history ----------
  const past = [];
  const future = [];
  let lastSnapshot = 0;
  function snapshot(force) {
    const now = Date.now();
    if (!force && now - lastSnapshot < 700) return;
    lastSnapshot = now;
    const html = editor.innerHTML;
    if (past.length && past[past.length - 1] === html) return;
    past.push(html);
    if (past.length > 200) past.shift();
    future.length = 0;
  }
  function restore(html) {
    editor.innerHTML = html;
    decorate();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    changed(true);
  }
  function undo() { if (!past.length) return; future.push(editor.innerHTML); restore(past.pop()); lastSnapshot = 0; }
  function redo() { if (!future.length) return; past.push(editor.innerHTML); restore(future.pop()); lastSnapshot = 0; }

  // ---------- change notifications ----------
  let timer = null;
  function changed(immediate) {
    updatePlaceholder();
    clearTimeout(timer);
    const send = () => post({ type: "content", doc: serialize() });
    if (immediate) send(); else timer = setTimeout(send, 250);
    reportState();
  }

  // ---------- inline styling ----------
  function textNodesIn(range) {
    const nodes = [];
    if (range.collapsed) return nodes;
    const walker = document.createTreeWalker(range.commonAncestorContainer.nodeType === 3 ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) if (range.intersectsNode(node) && node.data.length) nodes.push(node);
    return nodes;
  }
  function splitBoundaries(range) {
    if (range.startContainer.nodeType === 3 && range.startOffset > 0 && range.startOffset < range.startContainer.data.length) {
      const tail = range.startContainer.splitText(range.startOffset);
      if (range.endContainer === range.startContainer) range.setEnd(tail, range.endOffset - range.startOffset);
      range.setStart(tail, 0);
    }
    if (range.endContainer.nodeType === 3 && range.endOffset > 0 && range.endOffset < range.endContainer.data.length) range.endContainer.splitText(range.endOffset);
  }
  function hasContent(fragment) { return fragment.textContent.length > 0 || (fragment.querySelector && fragment.querySelector("img,br")); }
  // Moves the parts of `el` outside the range into clones before / after it, leaving `el` covering
  // only the selected part.
  function peel(range, el) {
    if (el.contains(range.startContainer) || el === range.startContainer) {
      const before = document.createRange();
      before.setStart(el, 0);
      before.setEnd(range.startContainer, range.startOffset);
      const fragment = before.extractContents();
      if (hasContent(fragment)) { const clone = el.cloneNode(false); clone.appendChild(fragment); el.parentNode.insertBefore(clone, el); }
    }
    if (el.contains(range.endContainer) || el === range.endContainer) {
      const after = document.createRange();
      after.setStart(range.endContainer, range.endOffset);
      after.setEnd(el, el.childNodes.length);
      const fragment = after.extractContents();
      if (hasContent(fragment)) { const clone = el.cloneNode(false); clone.appendChild(fragment); el.parentNode.insertBefore(clone, el.nextSibling); }
    }
  }
  function unwrap(el) { const parent = el.parentNode; while (el.firstChild) parent.insertBefore(el.firstChild, el); parent.removeChild(el); }
  function ancestorsMatching(range, test) {
    const found = new Set();
    for (const text of textNodesIn(range)) {
      let node = text.parentNode;
      while (node && node !== editor) { if (node.nodeType === 1 && test(node)) found.add(node); node = node.parentNode; }
    }
    return Array.from(found);
  }
  // Removes an inline property from the selection: matching ancestors are split at the selection edges
  // and stripped (or unwrapped when nothing is left on them).
  function clearInline(range, test, strip) {
    for (const el of ancestorsMatching(range, test)) {
      if (!el.parentNode) continue;
      peel(range, el);
      strip(el);
      if ((el.tagName === "SPAN" || el.tagName === "FONT") && !el.getAttribute("style") && !el.hasAttribute("data-font-id") && !el.hasAttribute("color")) unwrap(el);
    }
  }
  function wrapInline(range, make) {
    splitBoundaries(range);
    const nodes = textNodesIn(range);
    for (const text of nodes) {
      const wrapper = make();
      text.parentNode.insertBefore(wrapper, text);
      wrapper.appendChild(text);
    }
    if (nodes.length) {
      range.setStartBefore(nodes[0].parentNode);
      range.setEndAfter(nodes[nodes.length - 1].parentNode);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
  function styleProperty(name) {
    return {
      test: (el) => (el.tagName === "SPAN" || el.tagName === "FONT") && (el.style.getPropertyValue(name) || (name === "color" && el.hasAttribute("color"))),
      strip: (el) => { el.style.removeProperty(name); if (name === "color") el.removeAttribute("color"); if (!el.getAttribute("style")) el.removeAttribute("style"); },
    };
  }
  function setInlineStyle(name, value, extra) {
    const range = selectionRange();
    if (!range || range.collapsed) return;
    snapshot(true);
    const property = styleProperty(name);
    clearInline(range, property.test, property.strip);
    if (name === "font-family") clearInline(range, (el) => el.hasAttribute("data-font-id"), (el) => el.removeAttribute("data-font-id"));
    if (value !== null) wrapInline(range, () => { const span = document.createElement("span"); span.style.setProperty(name, value); if (extra) extra(span); return span; });
    changed();
  }
  function setHighlight(color) {
    const range = selectionRange();
    if (!range || range.collapsed) return;
    snapshot(true);
    clearInline(range, (el) => el.tagName === "MARK", unwrap);
    if (color) wrapInline(range, () => { const mark = document.createElement("mark"); mark.setAttribute("data-color", color); mark.style.backgroundColor = color; return mark; });
    changed();
  }
  function clearFormatting() {
    const range = selectionRange();
    if (!range || range.collapsed) return;
    snapshot(true);
    document.execCommand("removeFormat");
    const again = selectionRange();
    if (again) clearInline(again, (el) => /^(MARK|SPAN|FONT|A|CODE|SUB|SUP|B|STRONG|I|EM|U|S|STRIKE|DEL)$/.test(el.tagName), unwrap);
    changed();
  }

  // ---------- blocks & lists ----------
  function currentList() { return closest(anchorElement(), (el) => el.tagName === "UL" || el.tagName === "OL"); }
  function currentItem() { return closest(anchorElement(), (el) => el.tagName === "LI"); }
  function convertList(list, toTask) {
    const next = document.createElement("ul");
    if (toTask) next.setAttribute("data-type", "taskList");
    for (const li of Array.from(list.children)) {
      if (li.tagName !== "LI") continue;
      const fresh = document.createElement("li");
      const holder = li.querySelector(":scope > div");
      const source = li.getAttribute("data-type") === "taskItem" && holder ? holder : li;
      for (const child of Array.from(source.childNodes)) if (!(child.tagName === "LABEL")) fresh.appendChild(child);
      if (toTask) { fresh.setAttribute("data-type", "taskItem"); fresh.setAttribute("data-checked", "false"); }
      next.appendChild(fresh);
    }
    list.parentNode.replaceChild(next, list);
    decorateTasks();
    placeCaret(next.querySelector("p, li") || next);
  }
  function placeCaret(node, atStart) {
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(!!atStart);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
  function toggleList(kind) {
    snapshot(true);
    const list = currentList();
    const isTask = list && list.getAttribute("data-type") === "taskList";
    if (kind === "task") {
      if (isTask) convertList(list, false);
      else if (list) convertList(list, true);
      else { document.execCommand("insertUnorderedList"); const fresh = currentList(); if (fresh) convertList(fresh, true); }
    } else {
      const command = kind === "ordered" ? "insertOrderedList" : "insertUnorderedList";
      if (isTask) { convertList(list, false); if (kind === "ordered") document.execCommand("insertOrderedList"); }
      else document.execCommand(command);
    }
    changed();
  }
  function sink() {
    const li = currentItem();
    if (!li) return;
    const previous = li.previousElementSibling;
    if (!previous || previous.tagName !== "LI") return;
    snapshot(true);
    const list = li.parentNode;
    let nested = Array.from(previous.children).reverse().find((c) => c.tagName === list.tagName);
    const holder = previous.getAttribute("data-type") === "taskItem" ? (previous.querySelector(":scope > div") || previous) : previous;
    if (!nested) {
      nested = document.createElement(list.tagName);
      if (list.getAttribute("data-type")) nested.setAttribute("data-type", list.getAttribute("data-type"));
      holder.appendChild(nested);
    }
    nested.appendChild(li);
    placeCaret(li);
    changed();
  }
  function lift() {
    const li = currentItem();
    if (!li) return;
    snapshot(true);
    const list = li.parentNode;
    const parentItem = closest(list.parentNode, (el) => el.tagName === "LI");
    if (parentItem) {
      parentItem.parentNode.insertBefore(li, parentItem.nextSibling);
      if (!list.children.length) list.remove();
    } else {
      const holder = li.querySelector(":scope > div") || li;
      const after = document.createElement(list.tagName);
      for (const attr of list.attributes) after.setAttribute(attr.name, attr.value);
      let sibling = li.nextSibling;
      while (sibling) { const next = sibling.nextSibling; after.appendChild(sibling); sibling = next; }
      const fragment = document.createDocumentFragment();
      for (const child of Array.from(holder.childNodes)) if (child.tagName !== "LABEL") fragment.appendChild(child);
      if (!fragment.firstChild || !isBlock(fragment.firstChild)) { const p = document.createElement("p"); while (fragment.firstChild) p.appendChild(fragment.firstChild); if (!p.firstChild) p.innerHTML = "<br>"; fragment.appendChild(p); }
      const inserted = Array.from(fragment.childNodes);
      const first = inserted[0];
      const anchor = list.nextSibling;
      for (const node of inserted) list.parentNode.insertBefore(node, anchor);
      if (after.children.length) list.parentNode.insertBefore(after, anchor);
      li.remove();
      if (!list.children.length) list.remove();
      placeCaret(first);
    }
    changed();
  }
  function setBlock(block) {
    snapshot(true);
    const tag = block === "paragraph" ? "p" : block;
    document.execCommand("formatBlock", false, tag);
    changed();
  }
  function toggleWrapper(tag) {
    snapshot(true);
    const inside = closest(anchorElement(), (el) => el.tagName === tag.toUpperCase());
    if (inside) {
      if (tag === "pre") {
        const p = document.createElement("p");
        p.textContent = inside.textContent || "";
        if (!p.textContent) p.innerHTML = "<br>";
        inside.parentNode.replaceChild(p, inside);
        placeCaret(p);
      } else unwrap(inside);
    } else document.execCommand("formatBlock", false, tag);
    changed();
  }

  // ---------- links, images, tables ----------
  function setLink(href) {
    snapshot(true);
    const link = closest(anchorElement(), (el) => el.tagName === "A");
    const range = selectionRange();
    if (link && (!range || range.collapsed)) link.setAttribute("href", href);
    else if (range && !range.collapsed) document.execCommand("createLink", false, href);
    else document.execCommand("insertHTML", false, '<a href="' + href.replace(/"/g, "&quot;") + '">' + href.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;")) + "</a>");
    changed();
  }
  function unlink() {
    const link = closest(anchorElement(), (el) => el.tagName === "A");
    if (!link) return;
    snapshot(true);
    unwrap(link);
    changed();
  }
  let selectedImage = null;
  function selectImage(img) {
    if (selectedImage) selectedImage.classList.remove("vp-selected");
    selectedImage = img;
    if (img) img.classList.add("vp-selected");
    reportState();
  }
  function insertImage(src, width) {
    snapshot(true);
    const html = '<img src="' + src + '" width="' + width + '" style="width:' + width + 'px" draggable="false">';
    document.execCommand("insertHTML", false, html);
    changed();
  }
  function setImageWidth(width) {
    if (!selectedImage) return;
    snapshot(true);
    selectedImage.setAttribute("width", String(Math.round(width)));
    selectedImage.style.width = Math.round(width) + "px";
    changed();
  }
  function deleteImage() {
    if (!selectedImage) return;
    snapshot(true);
    selectedImage.remove();
    selectedImage = null;
    changed();
  }
  function currentCell() { return closest(anchorElement(), (el) => el.tagName === "TD" || el.tagName === "TH"); }
  function insertTable() {
    snapshot(true);
    const head = "<tr>" + "<th><p><br></p></th>".repeat(3) + "</tr>";
    const row = "<tr>" + "<td><p><br></p></td>".repeat(3) + "</tr>";
    document.execCommand("insertHTML", false, "<table><tbody>" + head + row + row + "</tbody></table><p><br></p>");
    changed();
  }
  function tableOp(op) {
    const cell = currentCell();
    if (!cell) return;
    const row = cell.parentNode;
    const table = closest(row, (el) => el.tagName === "TABLE");
    const index = Array.from(row.children).indexOf(cell);
    const rows = Array.from(table.querySelectorAll("tr")).filter((r) => r.closest("table") === table);
    snapshot(true);
    if (op === "addRow") {
      const fresh = document.createElement("tr");
      for (let i = 0; i < row.children.length; i++) { const td = document.createElement("td"); td.innerHTML = "<p><br></p>"; fresh.appendChild(td); }
      row.parentNode.insertBefore(fresh, row.nextSibling);
    } else if (op === "addColumn") {
      for (const r of rows) {
        const ref = r.children[index];
        const fresh = document.createElement(r.children[0] && r.children[0].tagName === "TH" && r === rows[0] ? "th" : "td");
        fresh.innerHTML = "<p><br></p>";
        r.insertBefore(fresh, ref ? ref.nextSibling : null);
      }
    } else if (op === "deleteRow") {
      row.remove();
      if (!table.querySelector("tr")) table.remove();
    } else if (op === "deleteColumn") {
      for (const r of rows) if (r.children[index]) r.children[index].remove();
      if (!table.querySelector("td,th")) table.remove();
    } else if (op === "headerRow") {
      const first = rows[0];
      const makeHeader = !Array.from(first.children).every((c) => c.tagName === "TH");
      for (const c of Array.from(first.children)) {
        const fresh = document.createElement(makeHeader ? "th" : "td");
        for (const attr of c.attributes) fresh.setAttribute(attr.name, attr.value);
        while (c.firstChild) fresh.appendChild(c.firstChild);
        first.replaceChild(fresh, c);
      }
    } else if (op === "delete") {
      table.remove();
    }
    changed();
  }

  // ---------- state ----------
  function query(command) { try { return document.queryCommandState(command); } catch (e) { return false; } }
  function reportState() {
    const el = anchorElement();
    const block = blockOf(el);
    const heading = closest(el, (n) => /^H[1-4]$/.test(n.tagName));
    const list = currentList();
    const item = currentItem();
    let fontId = null;
    let fontSize = null;
    let color = null;
    let highlight = null;
    for (let node = el; node && node !== editor; node = node.parentNode) {
      if (node.nodeType !== 1) continue;
      if (fontId === null && node.hasAttribute("data-font-id")) fontId = node.getAttribute("data-font-id");
      if (fontSize === null && node.style && /pt$/.test(node.style.fontSize || "")) fontSize = node.style.fontSize.replace(/pt$/, "");
      if (color === null && node.style && hex(node.style.color)) color = hex(node.style.color);
      if (color === null && node.tagName === "FONT" && hex(node.getAttribute("color"))) color = hex(node.getAttribute("color"));
      if (highlight === null && node.tagName === "MARK") highlight = hex(node.getAttribute("data-color")) || hex(node.style.backgroundColor);
    }
    const alignHolder = closest(el, (n) => /^(P|H[1-6]|DIV|LI|TD|TH)$/.test(n.tagName) && n.style.textAlign);
    const link = closest(el, (n) => n.tagName === "A");
    post({
      type: "state",
      block: heading ? "h" + heading.tagName[1] : "paragraph",
      bold: query("bold"),
      italic: query("italic"),
      underline: query("underline"),
      strike: query("strikeThrough"),
      superscript: query("superscript"),
      subscript: query("subscript"),
      link: link ? link.getAttribute("href") : null,
      list: list ? (list.getAttribute("data-type") === "taskList" ? "task" : list.tagName === "OL" ? "ordered" : "bullet") : null,
      quote: !!closest(el, (n) => n.tagName === "BLOCKQUOTE"),
      code: !!closest(el, (n) => n.tagName === "PRE"),
      table: !!currentCell(),
      align: alignHolder && ALIGNS.has(alignHolder.style.textAlign) ? alignHolder.style.textAlign : "left",
      fontId,
      fontSize,
      color,
      highlight,
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      canSink: !!(item && item.previousElementSibling && item.previousElementSibling.tagName === "LI"),
      canLift: !!item,
      image: selectedImage ? Math.round(Number(selectedImage.getAttribute("width")) || selectedImage.getBoundingClientRect().width) : null,
      inBlock: !!block,
    });
  }

  // ---------- events ----------
  editor.addEventListener("beforeinput", (event) => {
    if (event.inputType === "historyUndo") { event.preventDefault(); undo(); return; }
    if (event.inputType === "historyRedo") { event.preventDefault(); redo(); return; }
    snapshot(false);
  });
  editor.addEventListener("input", () => { decorate(); changed(); });
  document.addEventListener("selectionchange", () => reportState());
  editor.addEventListener("click", (event) => {
    const target = event.target;
    if (target.tagName === "IMG") { selectImage(target); return; }
    selectImage(null);
    if (target.tagName === "INPUT" && target.type === "checkbox") {
      const li = target.closest("li");
      if (li) { snapshot(true); li.setAttribute("data-checked", target.checked ? "true" : "false"); changed(); }
    }
    if (target.tagName === "A") event.preventDefault();
  });
  editor.addEventListener("keydown", (event) => {
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && key === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
    if (mod && key === "y") { event.preventDefault(); redo(); return; }
    if (mod && key === "enter") { event.preventDefault(); VP.cmd("pageBreak"); return; }
    if (mod && !event.altKey && key === "s") { event.preventDefault(); post({ type: "shortcut", name: event.shiftKey ? "saveAs" : "save" }); return; }
    if (mod && !event.altKey && !event.shiftKey && key === "e") { event.preventDefault(); post({ type: "shortcut", name: "export" }); return; }
    if (event.key === "Tab" && currentItem()) { event.preventDefault(); if (event.shiftKey) lift(); else sink(); return; }
    if ((event.key === "Backspace" || event.key === "Delete") && selectedImage) { event.preventDefault(); deleteImage(); }
  });
  editor.addEventListener("paste", (event) => {
    const html = event.clipboardData && event.clipboardData.getData("text/html");
    if (!html) return;
    event.preventDefault();
    snapshot(true);
    const holder = document.createElement("div");
    holder.innerHTML = html.replace(/<(script|style|iframe|object|embed|meta|link)\b[\s\S]*?(<\/\1>|>)/gi, "");
    for (const img of holder.querySelectorAll("img")) if (!/^data:image\//i.test(img.getAttribute("src") || "")) img.remove();
    document.execCommand("insertHTML", false, holder.innerHTML);
  });

  function fit() {
    const width = paper.getAttribute("data-width-px");
    if (!width) return;
    const gutter = window.innerWidth < 500 ? 16 : 48;
    const zoom = Math.min(1.25, Math.max(0.3, (window.innerWidth - gutter) / Number(width)));
    paper.style.zoom = String(zoom);
  }
  window.addEventListener("resize", fit);

  // ---------- public API ----------
  const VP = {
    load(html, options) {
      bodyFont = options.bodyFont || "";
      placeholder = options.placeholder || "";
      editor.innerHTML = html || "<p><br></p>";
      decorate();
      past.length = 0;
      future.length = 0;
      fit();
      post({ type: "loaded", doc: serialize() });
      reportState();
    },
    setPaper(widthPx) { paper.setAttribute("data-width-px", String(widthPx)); fit(); },
    setStyle(css) { document.getElementById("vp-style").textContent = css; },
    addFonts(css) { const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style); },
    setBodyFont(fontId) { bodyFont = fontId; },
    focus() { editor.focus(); },
    cmd(name, arg) {
      if (name !== "undo" && name !== "redo" && name !== "imageWidth" && name !== "deleteImage") editor.focus();
      switch (name) {
        case "undo": undo(); break;
        case "redo": redo(); break;
        case "bold": case "italic": case "underline": case "superscript": case "subscript":
          snapshot(true); document.execCommand(name); changed(); break;
        case "strike": snapshot(true); document.execCommand("strikeThrough"); changed(); break;
        case "block": setBlock(arg); break;
        case "align": snapshot(true); document.execCommand({ left: "justifyLeft", center: "justifyCenter", right: "justifyRight", justify: "justifyFull" }[arg]); changed(); break;
        case "list": toggleList(arg); break;
        case "sink": sink(); break;
        case "lift": lift(); break;
        case "quote": toggleWrapper("blockquote"); break;
        case "codeBlock": toggleWrapper("pre"); break;
        case "color": setInlineStyle("color", arg); break;
        case "highlight": setHighlight(arg); break;
        case "fontSize": setInlineStyle("font-size", arg ? arg + "pt" : null); break;
        case "font":
          if (!arg || arg.fontId === bodyFont) setInlineStyle("font-family", null);
          else setInlineStyle("font-family", arg.family, (span) => span.setAttribute("data-font-id", arg.fontId));
          break;
        case "clear": clearFormatting(); break;
        case "link": setLink(arg); break;
        case "unlink": unlink(); break;
        case "image": insertImage(arg.src, arg.width); break;
        case "imageWidth": setImageWidth(arg); break;
        case "deleteImage": deleteImage(); break;
        case "table": insertTable(); break;
        case "tableOp": tableOp(arg); break;
        case "rule": snapshot(true); document.execCommand("insertHorizontalRule"); changed(); break;
        case "pageBreak": snapshot(true); document.execCommand("insertHTML", false, '<div class="page-break" data-page-break="" contenteditable="false"></div><p><br></p>'); decorate(); changed(); break;
      }
    },
  };
  window.VP = VP;
  post({ type: "ready" });
})();
