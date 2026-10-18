import { plural } from "../i18n/plural";

type PagefindResult = { url: string; excerpt: string; meta: { title?: string } };
type Pagefind = {
  init?: () => Promise<void>;
  debouncedSearch: (q: string) => Promise<{ results: Array<{ data: () => Promise<PagefindResult> }> } | null>;
};

const root = document.documentElement;
const lang = root.lang;

const side = document.getElementById("docsSide");
const sideToggle = document.querySelector<HTMLButtonElement>("[data-side-toggle]");
function setSide(open: boolean) {
  if (!side || !sideToggle) return;
  side.classList.toggle("open", open);
  sideToggle.setAttribute("aria-expanded", String(open));
}
sideToggle?.addEventListener("click", () => setSide(!side?.classList.contains("open")));
document.addEventListener("click", (e) => {
  const t = e.target as Node;
  if (side?.classList.contains("open") && !side.contains(t) && !sideToggle?.contains(t)) setSide(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && side?.classList.contains("open")) {
    setSide(false);
    sideToggle?.focus();
  }
});

const dlg = document.getElementById("docsSearch") as HTMLElement;
const input = document.getElementById("dsInput") as HTMLInputElement;
const list = document.getElementById("dsList") as HTMLUListElement;
const empty = document.getElementById("dsEmpty") as HTMLElement;
const status = document.getElementById("dsStatus") as HTMLElement;
let opener: HTMLElement | null = null;
let pagefind: Pagefind | null = null;
let unavailable = false;
let sel = 0;
let hits: PagefindResult[] = [];
let ticket = 0;

async function loadPagefind(): Promise<Pagefind | null> {
  if (pagefind || unavailable) return pagefind;
  const url = "/pagefind/pagefind.js";
  try {
    pagefind = (await import(url)) as Pagefind;
    await pagefind.init?.();
  } catch {
    unavailable = true;
  }
  return pagefind;
}

function openSearch(from: HTMLElement | null) {
  opener = from;
  dlg.hidden = false;
  root.classList.add("no-scroll");
  input.focus();
  input.select();
  void loadPagefind();
}

function closeSearch() {
  if (dlg.hidden) return;
  dlg.hidden = true;
  root.classList.remove("no-scroll");
  opener?.focus({ preventScroll: true });
}

function mark() {
  [...list.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === sel)));
  const active = list.children[sel] as HTMLElement | undefined;
  if (active) {
    input.setAttribute("aria-activedescendant", active.id);
    active.scrollIntoView({ block: "nearest" });
  } else input.removeAttribute("aria-activedescendant");
}

function excerptNodes(html: string): Node[] {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  return [...parsed.body.childNodes].map((n) => {
    if (n.nodeName !== "MARK") return document.createTextNode(n.textContent ?? "");
    const mark = document.createElement("mark");
    mark.textContent = n.textContent;
    return mark;
  });
}

function render(q: string) {
  list.replaceChildren(
    ...hits.map((h, i) => {
      const li = document.createElement("li");
      li.id = `ds-${i}`;
      li.setAttribute("role", "option");
      const a = document.createElement("a");
      a.href = h.url;
      a.tabIndex = -1;
      const b = document.createElement("b");
      b.textContent = h.meta.title ?? h.url;
      const p = document.createElement("span");
      p.append(...excerptNodes(h.excerpt));
      a.append(b, p);
      li.append(a);
      return li;
    }),
  );
  const none = q.length > 0 && hits.length === 0;
  empty.hidden = !none;
  input.setAttribute("aria-expanded", String(hits.length > 0));
  if (unavailable && q) {
    empty.hidden = false;
    (empty.querySelector(".ds-empty-title") as HTMLElement).textContent = dlg.dataset.unavailable ?? "";
  }
  status.textContent = q ? plural(lang, { one: dlg.dataset.one ?? "#", other: dlg.dataset.other ?? "#" }, hits.length) : "";
  sel = 0;
  mark();
}

input.addEventListener("input", async () => {
  const q = input.value.trim();
  const mine = ++ticket;
  if (!q) {
    hits = [];
    render("");
    return;
  }
  const pf = await loadPagefind();
  if (!pf) {
    hits = [];
    render(q);
    return;
  }
  const res = await pf.debouncedSearch(q);
  if (!res || mine !== ticket) return;
  const data = await Promise.all(res.results.slice(0, 8).map((r) => r.data()));
  if (mine !== ticket) return;
  hits = data;
  render(q);
});

input.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (!hits.length) return;
    e.preventDefault();
    sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
    mark();
  } else if (e.key === "Enter" && hits[sel]) {
    e.preventDefault();
    location.href = hits[sel].url;
  }
});

dlg.addEventListener("click", (e) => {
  if ((e.target as Element).closest("[data-ds-close]")) closeSearch();
});
dlg.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    closeSearch();
  } else if (e.key === "Tab") {
    e.preventDefault();
    input.focus();
  }
});
document.querySelectorAll<HTMLElement>("[data-search-open]").forEach((b) => b.addEventListener("click", () => openSearch(b)));
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (dlg.hidden) openSearch(document.activeElement as HTMLElement | null);
    else closeSearch();
  }
});

const tocLinks = [...document.querySelectorAll<HTMLAnchorElement>("[data-toc]")];
if (tocLinks.length) {
  const targets = tocLinks.map((a) => document.getElementById(a.dataset.toc ?? "")).filter((t): t is HTMLElement => !!t);
  const update = () => {
    let current = targets[0]?.id;
    for (const t of targets) if (t.getBoundingClientRect().top < 140) current = t.id;
    tocLinks.forEach((a) => {
      const on = a.dataset.toc === current;
      a.classList.toggle("on", on);
      if (on) a.setAttribute("aria-current", "location");
      else a.removeAttribute("aria-current");
    });
  };
  let frame = 0;
  addEventListener(
    "scroll",
    () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          update();
        });
    },
    { passive: true },
  );
  update();
}

const KEYS_STORE = "vp-keys";
const keyButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-keys-set]")];
if (keyButtons.length) {
  const setKeys = (k: string, save: boolean) => {
    root.dataset.keys = k;
    keyButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.keysSet === k)));
    if (save) {
      try {
        localStorage.setItem(KEYS_STORE, k);
      } catch {
        return;
      }
    }
  };
  const readStored = () => {
    try {
      return localStorage.getItem(KEYS_STORE);
    } catch {
      return null;
    }
  };
  const initial = readStored() ?? root.dataset.keys ?? "win";
  setKeys(initial, false);
  keyButtons.forEach((b) => b.addEventListener("click", () => setKeys(b.dataset.keysSet ?? "win", true)));
}

const table = document.querySelector<HTMLElement>("[data-tool-table]");
if (table) {
  const filter = table.querySelector<HTMLInputElement>("[data-tool-filter]") as HTMLInputElement;
  const count = table.querySelector<HTMLElement>("[data-tool-count]") as HTMLElement;
  const none = table.querySelector<HTMLElement>("[data-tool-none]") as HTMLElement;
  const forms = { one: table.dataset.one ?? "#", other: table.dataset.other ?? "#" };
  const rows = [...table.querySelectorAll<HTMLElement>("[data-tool-row]")].map((r) => ({ r, text: (r.textContent ?? "").toLocaleLowerCase(lang) }));
  const groups = [...table.querySelectorAll<HTMLElement>("[data-tool-group]")];
  filter.addEventListener("input", () => {
    const q = filter.value.trim().toLocaleLowerCase(lang);
    let n = 0;
    rows.forEach(({ r, text }) => {
      const show = !q || text.includes(q);
      r.hidden = !show;
      if (show) n++;
    });
    groups.forEach((g) => (g.hidden = !g.querySelector("[data-tool-row]:not([hidden])")));
    none.hidden = n > 0;
    count.textContent = plural(lang, forms, n);
  });
}
