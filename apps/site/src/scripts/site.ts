import { watchPerformance } from "./perf";

const root = document.documentElement;
const still = root.classList.contains("still");

const themeBtn = document.getElementById("themeBtn") as HTMLButtonElement | null;
const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

function syncTheme() {
  const dark = root.dataset.theme === "dark";
  themeBtn?.setAttribute("aria-pressed", String(dark));
  if (themeMeta) themeMeta.content = dark ? "#0F1115" : "#EAF2FB";
}

function applyTheme(theme: "light" | "dark") {
  root.dataset.theme = theme;
  syncTheme();
  try {
    localStorage.setItem("vp-theme", theme);
  } catch {}
  window.dispatchEvent(new CustomEvent("vp:theme", { detail: theme }));
}

syncTheme();

themeBtn?.addEventListener("click", () => {
  const next = root.dataset.theme === "dark" ? "light" : "dark";
  if (still || !document.startViewTransition) {
    applyTheme(next);
    return;
  }
  const r = themeBtn.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const radius = Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy));
  const vt = document.startViewTransition(() => applyTheme(next));
  vt.ready
    .then(() =>
      root.animate(
        { clipPath: [`circle(0px at ${cx}px ${cy}px)`, `circle(${radius}px at ${cx}px ${cy}px)`] },
        { duration: 950, easing: "cubic-bezier(.7,0,.2,1)", pseudoElement: "::view-transition-new(root)" },
      ),
    )
    .catch(() => {});
});

watchPerformance();

const menuBtn = document.querySelector<HTMLButtonElement>(".menu-btn");
const mnav = document.getElementById("mnav");

function setMenu(open: boolean) {
  if (!menuBtn || !mnav) return;
  menuBtn.setAttribute("aria-expanded", String(open));
  menuBtn.setAttribute("aria-label", (open ? menuBtn.dataset.close : menuBtn.dataset.open) ?? "");
  mnav.hidden = !open;
}

menuBtn?.addEventListener("click", () => setMenu(Boolean(mnav?.hidden)));
mnav?.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setMenu(false)));
document.querySelectorAll<HTMLAnchorElement>(".seg a[hreflang], .mnav a[hreflang]").forEach((a) =>
  a.addEventListener("click", () => {
    try {
      localStorage.setItem("vp-lang", a.hreflang);
    } catch {}
  }),
);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && mnav && !mnav.hidden) {
    setMenu(false);
    menuBtn?.focus();
  }
});

addEventListener(
  "pointermove",
  (e) => {
    const target = e.target as Element | null;
    const glass = target?.closest?.<HTMLElement>(".glass");
    if (!glass) return;
    const r = glass.getBoundingClientRect();
    glass.style.setProperty("--mx", `${(e.clientX - r.left).toFixed(0)}px`);
    glass.style.setProperty("--my", `${(e.clientY - r.top).toFixed(0)}px`);
  },
  { passive: true },
);
