import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import type { HomeCopy } from "../i18n/home";
import { vp } from "./hero-state";
import { enableLite, isLite, softwareRendering } from "./perf";

type HomeGuide = { t: string; d: string; s: string[]; h: string; i: string };
export type HomeData = HomeCopy["script"] & { guides: HomeGuide[] };
type Plural = { one: string; other: string };

const data = JSON.parse(document.getElementById("homeData")?.textContent ?? "{}") as HomeData;
const root = document.documentElement;
let still = root.classList.contains("still");
vp.still = still;

const $ = <T extends Element = HTMLElement>(s: string, c: ParentNode = document) => c.querySelector<T>(s) as T;
const $$ = <T extends Element = HTMLElement>(s: string, c: ParentNode = document) => [...c.querySelectorAll<T>(s)];
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const plurals = new Intl.PluralRules(data.locale);
const plural = (forms: Plural, n: number) => (plurals.select(n) === "one" ? forms.one : forms.other).replace("#", String(n));
let lenis: Lenis | null = null;
const inView = (el: Element, fn: (on: boolean) => void, opt?: IntersectionObserverInit) =>
  new IntersectionObserver((es) => es.forEach((e) => fn(e.isIntersecting)), opt).observe(el);

const hero = $(".hero");
const bg = $<HTMLCanvasElement>("#heroBg");
vp.bg = bg;

function rr(x: CanvasRenderingContext2D, l: number, t: number, w: number, h: number, r: number) {
  x.beginPath();
  x.moveTo(l + r, t);
  x.arcTo(l + w, t, l + w, t + h, r);
  x.arcTo(l + w, t + h, l, t + h, r);
  x.arcTo(l, t + h, l, t, r);
  x.arcTo(l, t, l + w, t, r);
  x.closePath();
}

function pool(x: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, rot: number, col: string, a: number) {
  x.save();
  x.translate(cx, cy);
  x.rotate(rot);
  x.scale(1, ry / rx);
  const g = x.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(${col},${a})`);
  g.addColorStop(1, `rgba(${col},0)`);
  x.fillStyle = g;
  x.fillRect(-rx, -rx, rx * 2, rx * 2);
  x.restore();
}

type SheetKind = keyof HomeData["sheetTitles"];
type Sheet = { cx: number; cy: number; w: number; h: number; r: number; k: SheetKind };
let dkBg = false;
const sheetLight = { paper: "rgba(255,255,255,.96)", edge: "transparent", title: "#0A1A33", accent: "#7FD0FF", rule: "#DCE5F0", bar: "#BFE3FF", barHi: "#2F8FE6", bubble: "#8796AD", mark: "#14305A", frame: "#14305A", seal: "#FFC46B", sealCore: "#2F8FE6" };
const sheetDark = { paper: "#22252C", edge: "rgba(224,226,230,.10)", title: "#E0E2E6", accent: "#45A6DE", rule: "rgba(224,226,230,.16)", bar: "rgba(69,166,222,.32)", barHi: "#45A6DE", bubble: "rgba(224,226,230,.38)", mark: "#8BCAEE", frame: "rgba(139,202,238,.45)", seal: "rgba(255,196,107,.7)", sealCore: "#45A6DE" };

function sheet(x: CanvasRenderingContext2D, o: Sheet, s: number) {
  const w = o.w * s;
  const h = o.h * s;
  const c = dkBg ? sheetDark : sheetLight;
  x.save();
  x.translate(o.cx, o.cy);
  x.rotate(o.r);
  x.shadowColor = dkBg ? "rgba(0,0,0,.6)" : "rgba(20,48,90,.18)";
  x.shadowBlur = s * 0.07;
  x.shadowOffsetY = s * 0.025;
  x.fillStyle = c.paper;
  rr(x, -w / 2, -h / 2, w, h, Math.max(3, s * 0.01));
  x.fill();
  x.shadowColor = "transparent";
  x.strokeStyle = c.edge;
  x.lineWidth = 1;
  x.stroke();
  const L = -w / 2 + w * 0.11;
  const T = -h / 2 + h * 0.1;
  const cw = w * 0.78;
  x.fillStyle = c.title;
  x.font = `600 ${Math.round(h * 0.06)}px "Geist Variable", sans-serif`;
  x.textBaseline = "alphabetic";
  x.fillText(data.sheetTitles[o.k], L, T + h * 0.05);
  x.fillStyle = c.accent;
  x.fillRect(L, T + h * 0.085, cw * 0.32, Math.max(2, h * 0.012));
  let y = T + h * 0.15;
  const line = (f: number) => {
    x.fillStyle = c.rule;
    rr(x, L, y, cw * f, Math.max(2, h * 0.013), 2);
    x.fill();
    y += h * 0.042;
  };
  if (o.k === "report") {
    line(1);
    line(0.9);
    line(0.95);
    const bh = h * 0.2;
    const by = y + bh;
    [0.45, 0.6, 0.52, 0.85, 0.7].forEach((v, i) => {
      x.fillStyle = i === 3 ? c.barHi : c.bar;
      x.fillRect(L + i * cw * 0.2, by - bh * v, cw * 0.14, bh * v);
    });
    y = by + h * 0.05;
    line(1);
    line(0.7);
  } else if (o.k === "exam") {
    for (let q = 0; q < 4; q++) {
      line(0.85);
      for (let b = 0; b < 5; b++) {
        x.beginPath();
        x.arc(L + cw * 0.06 + b * cw * 0.11, y + h * 0.005, h * 0.014, 0, Math.PI * 2);
        x.strokeStyle = c.bubble;
        x.lineWidth = 1;
        if (b === (q * 2 + 1) % 5) {
          x.fillStyle = c.mark;
          x.fill();
        } else x.stroke();
      }
      y += h * 0.05;
    }
  } else if (o.k === "cert") {
    x.strokeStyle = c.frame;
    x.lineWidth = 1.4;
    x.strokeRect(-w / 2 + w * 0.05, -h / 2 + h * 0.07, w * 0.9, h * 0.86);
    y = T + h * 0.3;
    line(0.8);
    line(0.6);
    x.beginPath();
    x.arc(0, h * 0.2, h * 0.08, 0, Math.PI * 2);
    x.fillStyle = c.seal;
    x.fill();
    x.beginPath();
    x.arc(0, h * 0.2, h * 0.045, 0, Math.PI * 2);
    x.fillStyle = c.sealCore;
    x.fill();
  } else {
    line(1);
    line(0.94);
    line(0.98);
    line(0.6);
    y += h * 0.03;
    line(1);
    line(0.9);
    line(0.96);
    line(0.7);
    x.strokeStyle = c.mark;
    x.lineWidth = 1.6;
    x.beginPath();
    const sy = h * 0.34;
    x.moveTo(L, sy);
    x.bezierCurveTo(L + cw * 0.1, sy - h * 0.08, L + cw * 0.18, sy + h * 0.04, L + cw * 0.26, sy - h * 0.03);
    x.bezierCurveTo(L + cw * 0.34, sy - h * 0.08, L + cw * 0.38, sy + h * 0.03, L + cw * 0.5, sy - h * 0.01);
    x.stroke();
  }
  x.restore();
}

function drawBackdrop() {
  dkBg = root.dataset.theme === "dark";
  const W = hero.clientWidth;
  const H = hero.clientHeight;
  const d = Math.min(window.devicePixelRatio || 1, 1.5);
  const m = vp.mark;
  const s = m.s;
  bg.width = Math.round(W * d);
  bg.height = Math.round(H * d);
  const x = bg.getContext("2d");
  if (!x) return;
  x.setTransform(d, 0, 0, d, 0, 0);
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, dkBg ? "#16181D" : "#F3F8FE");
  g.addColorStop(1, dkBg ? "#0F1115" : "#EAF2FB");
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  pool(x, m.x - s * 0.05, m.y - s * 0.1, s * 1.15, s * 0.42, -1.25, dkBg ? "69,166,222" : "127,208,255", dkBg ? 0.24 : 0.62);
  pool(x, m.x + s * 0.25, m.y + s * 0.05, s * 1.0, s * 0.3, 1.27, dkBg ? "69,166,222" : "47,143,230", dkBg ? 0.2 : 0.24);
  pool(x, m.x + s * 0.1, m.y + s * 0.55, s * 0.55, s * 0.4, 0, dkBg ? "69,166,222" : "255,196,107", dkBg ? 0.08 : 0.42);
  pool(x, W * 0.96, H * 0.9, W * 0.4, W * 0.3, 0, dkBg ? "69,166,222" : "47,143,230", dkBg ? 0.12 : 0.16);
  pool(x, W * 0.2, H * 0.78, W * 0.42, H * 0.4, 0, dkBg ? "15,17,21" : "255,255,255", dkBg ? 0.5 : 0.6);
  x.save();
  x.font = `600 ${Math.round(s * 0.66)}px "Geist Variable", sans-serif`;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.lineWidth = 1.4;
  x.strokeStyle = dkBg ? "rgba(139,202,238,.16)" : "rgba(26,98,176,.22)";
  x.strokeText("PDF", m.x, m.y + s * 0.02);
  x.restore();
  const S: Array<{ dx: number; dy: number; w: number; h: number; r: number; k: SheetKind }> = [
    { dx: -0.66, dy: -0.2, w: 0.48, h: 0.66, r: -0.16, k: "report" },
    { dx: 0.58, dy: -0.3, w: 0.44, h: 0.6, r: 0.17, k: "exam" },
    { dx: 0.5, dy: 0.36, w: 0.52, h: 0.37, r: -0.07, k: "cert" },
    { dx: -0.12, dy: 0.08, w: 0.42, h: 0.6, r: 0.06, k: "letter" },
  ];
  S.forEach((o) => sheet(x, { cx: m.x + o.dx * s, cy: m.y + o.dy * s, w: o.w, h: o.h, r: o.r, k: o.k }, s));
  pool(x, m.x, m.y, s * 0.75, s * 0.75, 0, dkBg ? "224,226,230" : "255,255,255", dkBg ? 0.04 : 0.18);
  vp.onBg?.();
}

function smallViewportHeight(): number {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;top:0;height:100svh;visibility:hidden;pointer-events:none";
  document.body.append(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return h;
}

function layout() {
  const W = hero.clientWidth;
  const H = hero.clientHeight;
  const vh = window.innerHeight;
  const m = vp.mark;
  if (W >= 960) {
    const top = $(".hero-side").getBoundingClientRect().top - hero.getBoundingClientRect().top;
    const band = Math.max(200, top - 124);
    m.x = Math.min(W * 0.69, (W + 1200) / 2 - 260);
    m.s = Math.min(Math.min(H, vh) * 0.43, W * 0.32, band / 1.12);
    m.y = 100 + band * 0.47;
  } else {
    const svh = smallViewportHeight();
    m.x = W * 0.5;
    m.y = Math.max(150, svh * 0.25);
    m.s = Math.min(svh * 0.28, window.innerWidth * 0.62);
  }
  hero.style.setProperty("--mx", m.x.toFixed(1));
  hero.style.setProperty("--my", m.y.toFixed(1));
  hero.style.setProperty("--ms", m.s.toFixed(1));
  const b = $(".brand svg").getBoundingClientRect();
  vp.logo = { x: b.left + b.width * 0.49, y: b.top + b.height / 2, s: b.height * 0.53 };
  drawBackdrop();
}

layout();
document.fonts?.ready.then(() => layout());
let rzT = 0;
addEventListener("resize", () => {
  clearTimeout(rzT);
  rzT = window.setTimeout(layout, 160);
});
addEventListener("vp:theme", (e) => {
  drawBackdrop();
  vp.onTheme?.((e as CustomEvent<string>).detail);
});

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function buildQr(svg: SVGElement, seed: number) {
  const rnd = seeded(seed);
  const n = 21;
  const o = 2;
  const ns = "http://www.w3.org/2000/svg";
  const finder = (x: number, y: number) => (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
  const inF = (x: number, y: number, fx: number, fy: number) => {
    const dx = x - fx;
    const dy = y - fy;
    if (dx < 0 || dy < 0 || dx > 6 || dy > 6) return false;
    return dx === 0 || dy === 0 || dx === 6 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
  };
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let on: boolean;
      if (finder(x, y)) on = inF(x, y, 0, 0) || inF(x, y, n - 7, 0) || inF(x, y, 0, n - 7);
      else if (x === 6 || y === 6) on = (x + y) % 2 === 0;
      else on = rnd() > 0.52;
      if (!on) continue;
      const r = document.createElementNS(ns, "rect");
      r.setAttribute("x", String(x + o));
      r.setAttribute("y", String(y + o));
      r.setAttribute("width", "1.02");
      r.setAttribute("height", "1.02");
      svg.appendChild(r);
    }
}
$$<SVGElement>(".qr-mini").forEach((s) => buildQr(s, 11));

type Group = keyof HomeData["insp"];
const caps = $$(".cap");
caps.forEach((c) => {
  $(".cap-dots", c).innerHTML = caps.map(() => "<i></i>").join("");
});
const win = $(".win");
const sideItems = $$(".si");
const order = caps.map((c) => c.dataset.g as Group);
const inspNum = $("#inspNum");
const inspSub = $("#inspSub");
const wtChip = $("#wtChip");
const twEl = $("#twName");
let cur = -1;
let twTimer = 0;

function typeName() {
  clearInterval(twTimer);
  const full = data.typeName;
  let n = 0;
  twEl.textContent = "";
  twTimer = window.setInterval(() => {
    twEl.textContent = full.slice(0, ++n);
    if (n >= full.length) clearInterval(twTimer);
  }, 80);
}

function setGroup(i: number) {
  if (i === cur) return;
  cur = i;
  const g = order[i];
  const cap = caps[i];
  win.dataset.g = g;
  sideItems.forEach((li) => {
    const k = order.indexOf(li.dataset.g as Group);
    li.classList.toggle("on", li.dataset.g === g);
    li.classList.toggle("seen", k > -1 && k < i);
  });
  caps.forEach((c, k) => {
    c.classList.toggle("on", k === i);
    $$(".cap-dots i", c).forEach((d, j) => d.classList.toggle("on", j <= i));
  });
  const name = $("h3", cap).textContent ?? "";
  const side = document.querySelector(`.si[data-g='${g}'] span`);
  $("#wbEyebrow").textContent = side ? side.textContent : name;
  $("#inspTool").textContent = name;
  wtChip.innerHTML = `<svg class="ic"><use href="#${data.chip[g][0]}"/></svg><span>${data.chip[g][1]}</span>`;
  const [n, l] = data.insp[g];
  if (g === "forms" && !still) setTimeout(typeName, 280);
  if (still) {
    inspNum.textContent = n;
    inspSub.textContent = l;
    return;
  }
  gsap.killTweensOf(inspNum);
  gsap.to(inspNum, {
    yPercent: -100,
    duration: 0.2,
    ease: "power2.in",
    onComplete: () => {
      inspNum.textContent = n;
      inspSub.textContent = l;
      gsap.fromTo(inspNum, { yPercent: 100 }, { yPercent: 0, duration: 0.6, ease: "expo.out" });
    },
  });
}
setGroup(0);

const stackedTour = matchMedia("(max-width:959px)");
const stepGroup = (d: number) => setGroup((cur + d + order.length) % order.length);
$("#tourPrev").addEventListener("click", () => stepGroup(-1));
$("#tourNext").addEventListener("click", () => stepGroup(1));
let swipeX = 0;
let swipeY = 0;
const tourInner = $(".tour-inner");
tourInner.addEventListener(
  "touchstart",
  (e) => {
    swipeX = e.touches[0].clientX;
    swipeY = e.touches[0].clientY;
  },
  { passive: true },
);
tourInner.addEventListener(
  "touchend",
  (e) => {
    if (!stackedTour.matches || still) return;
    const dx = e.changedTouches[0].clientX - swipeX;
    const dy = e.changedTouches[0].clientY - swipeY;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) stepGroup(dx < 0 ? 1 : -1);
  },
  { passive: true },
);

const log = $("#log");
let opI = 0;
const pad2 = (n: number) => String(n).padStart(2, "0");
const stamp = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
function row(d: Date, isNew: boolean) {
  const [op, file] = data.ops[opI++ % data.ops.length];
  const li = document.createElement("li");
  if (isNew) li.className = "new";
  li.innerHTML = `<time>${stamp(d)}</time><span><strong>${op}</strong> · ${file}</span><b>0 B</b>`;
  return li;
}
const now = Date.now();
for (let i = 4; i >= 0; i--) log.prepend(row(new Date(now - i * 7000), false));
const tick = () => {
  log.prepend(row(new Date(), !still));
  while (log.children.length > 5) log.lastElementChild?.remove();
};
if (!still) {
  let timer = 0;
  inView(log, (on) => {
    if (on && !timer) timer = window.setInterval(tick, 1900);
    else if (!on && timer) {
      clearInterval(timer);
      timer = 0;
    }
  });
}

const night = $(".night");
const netSw = $("#netSw");
const netMsg = $("#netMsg");
const netOn = netMsg.textContent ?? "";
const netOff = netMsg.dataset.off ?? "";
netSw.addEventListener("click", () => {
  const on = netSw.getAttribute("aria-checked") !== "true";
  netSw.setAttribute("aria-checked", String(on));
  const nr = night.getBoundingClientRect();
  const br = $(".sw-t", netSw).getBoundingClientRect();
  night.style.setProperty("--ox", `${(br.left + br.width / 2 - nr.left).toFixed(0)}px`);
  night.style.setProperty("--oy", `${(br.top + br.height / 2 - nr.top).toFixed(0)}px`);
  night.classList.toggle("offline", !on);
  netMsg.textContent = on ? netOn : netOff;
  if (!on) {
    tick();
    setTimeout(tick, 500);
  }
});

const cmp = $("#cmp");
const range = $<HTMLInputElement>("#cmpRange");
const setSplit = (v: number | string) => cmp.style.setProperty("--split", `${v}%`);
range.addEventListener("input", () => setSplit(range.value));

const padEl = $("#pad");
const cv = $<HTMLCanvasElement>("#sigPad");
const cx = cv.getContext("2d") as CanvasRenderingContext2D;
const sigName = $<HTMLInputElement>("#sigName");
const sigStatus = $("#sigStatus");
type Pt = { x: number; y: number; t: number };
let ink = false;
let drawing = false;
let prev: Pt = { x: 0, y: 0, t: 0 };
let mid: { x: number; y: number } = { x: 0, y: 0 };
let lw = 2.6;
function sizePad() {
  const r = cv.getBoundingClientRect();
  const d = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.max(1, Math.round(r.width * d));
  cv.height = Math.max(1, Math.round(r.height * d));
  cx.setTransform(d, 0, 0, d, 0, 0);
  cx.lineCap = "round";
  cx.lineJoin = "round";
  cx.strokeStyle = "#0A1A33";
  cx.fillStyle = "#0A1A33";
}
function clearPad() {
  cx.clearRect(0, 0, cv.width, cv.height);
  ink = false;
  padEl.classList.remove("inked", "signed");
  sigStatus.textContent = "";
  sigStatus.classList.remove("err");
}
sizePad();
addEventListener("resize", () => {
  if (!ink) sizePad();
});
const pt = (e: PointerEvent): Pt => {
  const r = cv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() };
};
cv.addEventListener("pointerdown", (e) => {
  if (e.button > 0) return;
  cv.setPointerCapture(e.pointerId);
  drawing = true;
  if (padEl.classList.contains("signed")) clearPad();
  prev = pt(e);
  mid = prev;
  lw = 2.6;
  ink = true;
  padEl.classList.add("inked");
  sigName.value = "";
  cx.beginPath();
  cx.arc(prev.x, prev.y, 1.2, 0, Math.PI * 2);
  cx.fill();
});
cv.addEventListener("pointermove", (e) => {
  if (!drawing) return;
  const p = pt(e);
  const dist = Math.hypot(p.x - prev.x, p.y - prev.y);
  if (dist < 1.2) return;
  const v = dist / Math.max(1, p.t - prev.t);
  lw = lw * 0.7 + clamp(3.4 - v * 1.3, 1.1, 3.4) * 0.3;
  const m = { x: (prev.x + p.x) / 2, y: (prev.y + p.y) / 2 };
  cx.lineWidth = lw;
  cx.beginPath();
  cx.moveTo(mid.x, mid.y);
  cx.quadraticCurveTo(prev.x, prev.y, m.x, m.y);
  cx.stroke();
  mid = m;
  prev = p;
});
const endDraw = () => {
  drawing = false;
};
cv.addEventListener("pointerup", endDraw);
cv.addEventListener("pointercancel", endDraw);
sigName.addEventListener("input", () => {
  const t = sigName.value.trim();
  cx.clearRect(0, 0, cv.width, cv.height);
  padEl.classList.remove("signed");
  sigStatus.textContent = "";
  sigStatus.classList.remove("err");
  if (!t) {
    ink = false;
    padEl.classList.remove("inked");
    return;
  }
  const r = cv.getBoundingClientRect();
  let fs = Math.min(64, r.height * 0.36);
  cx.font = `600 ${fs}px Caveat, cursive`;
  while (cx.measureText(t).width > r.width - 80 && fs > 20) {
    fs -= 2;
    cx.font = `600 ${fs}px Caveat, cursive`;
  }
  cx.save();
  cx.translate(40, r.height - 58);
  cx.rotate(-0.05);
  cx.fillText(t, 0, 0);
  cx.restore();
  ink = true;
  padEl.classList.add("inked");
});
$("#sigClear").addEventListener("click", () => {
  clearPad();
  sigName.value = "";
});
$("#sigApply").addEventListener("click", () => {
  if (!ink) {
    sigStatus.textContent = data.sig.needInk;
    sigStatus.classList.add("err");
    return;
  }
  padEl.classList.add("signed");
  sigStatus.classList.remove("err");
  sigStatus.textContent = data.sig.applied;
});

const list = $("#reorder");
const live = $("#ordLive");
let dragEl: HTMLElement | null = null;
let startX = 0;
let moved = false;
function flip(mutate: () => void) {
  const kids = [...list.children] as HTMLElement[];
  const first = new Map(kids.map((n) => [n, n.getBoundingClientRect().left]));
  mutate();
  if (still) return;
  kids.forEach((n) => {
    if (n === dragEl) return;
    const dx = (first.get(n) ?? 0) - n.getBoundingClientRect().left;
    if (Math.abs(dx) > 0.5) n.animate([{ transform: `translateX(${dx}px)` }, { transform: "translateX(0)" }], { duration: 300, easing: "cubic-bezier(.2,0,0,1)" });
  });
}
function announce(el: HTMLElement) {
  live.textContent = data.moved.replace("{n}", el.dataset.n ?? "").replace("{pos}", String([...list.children].indexOf(el) + 1));
}
list.addEventListener("keydown", (e) => {
  const el = (e.target as Element).closest<HTMLElement>(".pg");
  if (!el) return;
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    const back = e.key === "ArrowLeft";
    const sib = back ? el.previousElementSibling : el.nextElementSibling;
    if (!sib) return;
    flip(() => (back ? list.insertBefore(el, sib) : list.insertBefore(sib, el)));
    el.focus();
    announce(el);
  }
});
list.addEventListener("pointerdown", (e) => {
  const el = (e.target as Element).closest<HTMLElement>(".pg");
  if (!el || e.button > 0) return;
  dragEl = el;
  startX = e.clientX;
  moved = false;
  el.setPointerCapture(e.pointerId);
  el.classList.add("drag");
});
list.addEventListener("pointermove", (e) => {
  if (!dragEl) return;
  const el = dragEl;
  moved = true;
  const r = el.getBoundingClientRect();
  const mx = r.left + r.width / 2;
  const next = el.nextElementSibling;
  const prv = el.previousElementSibling;
  if (next) {
    const nr = next.getBoundingClientRect();
    if (mx > nr.left + nr.width / 2) {
      const b = el.offsetLeft;
      flip(() => list.insertBefore(next, el));
      startX += el.offsetLeft - b;
    }
  }
  if (prv) {
    const pr = prv.getBoundingClientRect();
    if (mx < pr.left + pr.width / 2) {
      const b = el.offsetLeft;
      flip(() => list.insertBefore(el, prv));
      startX += el.offsetLeft - b;
    }
  }
  el.style.transform = `translateX(${e.clientX - startX}px)`;
});
const endDrag = () => {
  if (!dragEl) return;
  const el = dragEl;
  dragEl = null;
  const m = /translateX\((-?[\d.]+)px\)/.exec(el.style.transform);
  const dx = m ? parseFloat(m[1]) : 0;
  el.style.transform = "";
  el.classList.remove("drag");
  if (!still && dx) el.animate([{ transform: `translateX(${dx}px)` }, { transform: "translateX(0)" }], { duration: 280, easing: "cubic-bezier(.2,0,0,1)" });
  if (moved) announce(el);
};
list.addEventListener("pointerup", endDrag);
list.addEventListener("pointercancel", endDrag);

type TemplateKey = keyof HomeData["templates"];
const rows: TemplateKey[][] = [
  ["cv", "exam", "cert", "inv", "plan", "rep"],
  ["bro", "key", "cv2", "menu", "exam", "inv"],
  ["rep", "cert", "plan", "cv", "key", "menu"],
];
const tagT = (k: TemplateKey) => data.templates[k].replace('<div class="tp', `<div data-t="${k}" class="tp`);
$("#wall").innerHTML = rows
  .map((r) => {
    const h = r.map(tagT).join("");
    return `<div class="wall-row">${h}${h}</div>`;
  })
  .join("");

const guides = data.guides;
const docInput = $<HTMLInputElement>("#docSearch");
const docList = $("#docList");
const docPrev = $("#docPrev");
const docEmpty = $("#docEmpty");
const docStatus = $("#docStatus");
const docCount = $("#docCount");
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
const fold = (t: string) => t.toLocaleLowerCase(data.locale);
const markQ = (t: string, q: string) => {
  const i = q ? fold(t).indexOf(q) : -1;
  return i < 0 ? esc(t) : `${esc(t.slice(0, i))}<mark>${esc(t.slice(i, i + q.length))}</mark>${esc(t.slice(i + q.length))}`;
};
let hits: number[] = [];
let sel = 0;
function showPrev(animate: boolean) {
  if (!hits.length) {
    docInput.removeAttribute("aria-activedescendant");
    return;
  }
  const g = guides[hits[sel]];
  const opts = $$(".opt", docList);
  opts.forEach((o, k) => o.setAttribute("aria-selected", String(k === sel)));
  docInput.setAttribute("aria-activedescendant", `doc-${hits[sel]}`);
  docPrev.innerHTML = `<p class="eyebrow">${esc(data.guideEyebrow)} · ${String(hits[sel] + 1).padStart(2, "0")}</p><h3>${esc(g.t)}</h3><p>${esc(g.d)}.</p><ol class="pal-steps">${g.s.map((x) => `<li>${esc(x)}</li>`).join("")}</ol><a class="text-link ul" href="${g.h}">${esc(data.openGuide)}<svg class="ic" aria-hidden="true"><use href="#i-arrow"/></svg></a>`;
  const o = opts[sel];
  if (o) {
    const top = docList.scrollTop;
    const h = docList.clientHeight;
    if (o.offsetTop < top) docList.scrollTop = o.offsetTop - 8;
    else if (o.offsetTop + o.offsetHeight > top + h) docList.scrollTop = o.offsetTop + o.offsetHeight - h + 8;
  }
  if (animate && !still) gsap.fromTo(docPrev.children, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: "expo.out", stagger: 0.04, overwrite: true });
}
function renderDocs(animate: boolean) {
  const q = fold(docInput.value.trim());
  hits = guides.map((_, i) => i).filter((i) => !q || fold([guides[i].t, guides[i].d, ...guides[i].s].join(" ")).includes(q));
  sel = Math.min(sel, Math.max(0, hits.length - 1));
  docList.innerHTML = hits
    .map((i, k) => {
      const g = guides[i];
      return `<li class="opt" role="option" id="doc-${i}" aria-selected="false" data-k="${k}"><span class="oi"><svg class="ic" aria-hidden="true"><use href="#${g.i}"/></svg></span><b>${markQ(g.t, q)}</b><span>${markQ(g.d, q)}</span></li>`;
    })
    .join("");
  const none = !hits.length;
  docEmpty.hidden = !none;
  docList.hidden = none;
  docPrev.hidden = none;
  docCount.textContent = none ? data.noMatch : plural(data.guideCount, hits.length);
  docStatus.textContent = q ? (none ? data.none : plural(data.found, hits.length)) : "";
  showPrev(animate);
}
renderDocs(false);
docInput.addEventListener("input", () => {
  sel = 0;
  renderDocs(true);
});
docInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (!hits.length) return;
    e.preventDefault();
    sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
    showPrev(true);
  } else if (e.key === "Enter") {
    if (!hits.length) return;
    e.preventDefault();
    location.href = guides[hits[sel]].h;
  } else if (e.key === "Escape" && docInput.value) {
    e.preventDefault();
    docInput.value = "";
    sel = 0;
    renderDocs(true);
  }
});
docList.addEventListener("click", (e) => {
  const o = (e.target as Element).closest<HTMLElement>(".opt");
  if (!o) return;
  const k = Number(o.dataset.k);
  if (k !== sel) {
    sel = k;
    showPrev(true);
  }
  docInput.focus({ preventScroll: true });
});
document.addEventListener("keydown", (e) => {
  if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) return;
  e.preventDefault();
  if (!$("#tplDlg").hidden) return;
  const t = $("[data-guides]");
  const go = () => docInput.focus({ preventScroll: true });
  if (lenis) lenis.scrollTo(t, { offset: -90, onComplete: go });
  else {
    t.scrollIntoView();
    go();
  }
});

const copyBtn = $("#copyBtn");
copyBtn.addEventListener("click", async () => {
  const label = $("span", copyBtn);
  const idle = label.textContent ?? "";
  const text = ($("#cmds").textContent ?? "").replace(/^\$ /gm, "");
  try {
    await navigator.clipboard.writeText(text);
    label.textContent = copyBtn.dataset.copied ?? "";
  } catch {
    label.textContent = copyBtn.dataset.failed ?? "";
  }
  setTimeout(() => (label.textContent = idle), 1800);
});

type LensMode = keyof HomeData["lensInfo"];
const lens = $("#lensStage");
const lzoom = $("#lensZoom");
const lc = $("#ldoc").cloneNode(true) as HTMLElement;
lc.removeAttribute("id");
lzoom.appendChild(lc);
const L = { x: 0, y: 0, tx: 0, ty: 0, rk: still ? 1 : 0, trk: 1, hover: false, on: false, t: 0, ready: false };
$$<HTMLButtonElement>(".lens-modes button").forEach((b) =>
  b.addEventListener("click", () => {
    const m = b.dataset.m as LensMode;
    $$(".lens-modes button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    lens.dataset.m = m;
    $("#lensTag").textContent = data.lensInfo[m][0];
    $("#lensNote").textContent = data.lensInfo[m][1];
    L.rk = 0.72;
  }),
);
const placeLens = (x: number, y: number) => {
  lens.style.setProperty("--lx", `${x.toFixed(1)}px`);
  lens.style.setProperty("--ly", `${y.toFixed(1)}px`);
};
lens.addEventListener("pointermove", (e) => {
  const r = lens.getBoundingClientRect();
  L.tx = e.clientX - r.left;
  L.ty = e.clientY - r.top;
  L.hover = true;
  L.trk = 1.14;
  lens.classList.add("used");
  if (still) placeLens(L.tx, L.ty);
});
lens.addEventListener("pointerdown", (e) => {
  const r = lens.getBoundingClientRect();
  L.tx = e.clientX - r.left;
  L.ty = e.clientY - r.top;
  L.hover = true;
  if (still) placeLens(L.tx, L.ty);
});
lens.addEventListener("pointerleave", () => {
  L.hover = false;
  L.trk = 1;
});
function lensFrame() {
  if (!L.on) return;
  const w = lens.clientWidth;
  const h = lens.clientHeight;
  L.t += 1 / 60;
  if (!L.ready) {
    L.x = w * 0.5;
    L.y = h * 0.46;
    L.ready = true;
  }
  if (!L.hover) {
    L.tx = w * (0.5 + 0.27 * Math.sin(L.t * 0.42));
    L.ty = h * (0.47 + 0.2 * Math.sin(L.t * 0.71 + 1.2));
  }
  L.x += (L.tx - L.x) * 0.12;
  L.y += (L.ty - L.y) * 0.12;
  L.rk += (L.trk - L.rk) * 0.1;
  placeLens(L.x, L.y);
  lens.style.setProperty("--rk", L.rk.toFixed(3));
}

type Slide = HomeData["slides"][number];
type Stroke = { tool: string; board: boolean; p: Array<[number, number]> };
const pres = $("#pres");
const preCv = $<HTMLCanvasElement>("#preInk");
const audCv = $<HTMLCanvasElement>("#audInk");
const audDot = $("#audDot");
const slides = data.slides as Slide[];
const slideHtml = (x: Slide) =>
  "end" in x && x.end ? `<div class="sl-end"><p class="sl-k">${x.k}</p><p class="sl-t">${x.t}</p>${x.b}</div>` : `<p class="sl-k">${x.k}</p><p class="sl-t">${x.t}</p>${x.b}`;
const inks: Record<string, Stroke[]> = {};
let page = 0;
let board = false;
let tool = "pen";
let stroke: Stroke | null = null;
let demo: gsap.core.Tween | null = null;
const inkKey = () => (board ? "board" : `p${page}`);
const inkStyle = (k: Stroke) => (k.tool === "hl" ? { c: "rgba(255,196,107,.55)", w: 0.026 } : { c: k.board ? "#F4F7FB" : "#E5484D", w: 0.0068 });
function fitCv(c: HTMLCanvasElement) {
  const r = c.getBoundingClientRect();
  const d = Math.min(window.devicePixelRatio || 1, 2);
  c.width = Math.max(1, Math.round(r.width * d));
  c.height = Math.max(1, Math.round(r.height * d));
}
function paintCv(c: HTMLCanvasElement) {
  const x = c.getContext("2d");
  if (!x) return;
  const W = c.width;
  const H = c.height;
  x.clearRect(0, 0, W, H);
  x.lineCap = "round";
  x.lineJoin = "round";
  (inks[inkKey()] ?? []).forEach((k) => {
    const st = inkStyle(k);
    x.strokeStyle = st.c;
    x.lineWidth = Math.max(1.5, st.w * W);
    x.beginPath();
    k.p.forEach((q, i) => (i ? x.lineTo(q[0] * W, q[1] * H) : x.moveTo(q[0] * W, q[1] * H)));
    if (k.p.length === 1) x.lineTo(k.p[0][0] * W + 0.5, k.p[0][1] * H);
    x.stroke();
  });
}
const paintInk = () => {
  paintCv(preCv);
  paintCv(audCv);
};
const fitInk = () => {
  fitCv(preCv);
  fitCv(audCv);
  paintInk();
};
function renderSlides() {
  $("#preSlide [data-slot]").innerHTML = slideHtml(slides[page]);
  $("#audSlide [data-slot]").innerHTML = slideHtml(slides[page]);
  const nx = slides[page + 1];
  $("#nextSlide [data-slot]").innerHTML = nx ? slideHtml(nx) : `<div class="sl-end"><p class="sl-sub">${data.endOfDeck}</p></div>`;
  $("#presNotes").textContent = slides[page].n;
  $("#presPage").textContent = `${page + 1} / ${slides.length}`;
  $<HTMLButtonElement>("#presPrev").disabled = page === 0;
  $<HTMLButtonElement>("#presNext").disabled = page === slides.length - 1;
  paintInk();
}
const moveDot = (q: [number, number]) => {
  audDot.style.left = `${(q[0] * 100).toFixed(2)}%`;
  audDot.style.top = `${(q[1] * 100).toFixed(2)}%`;
  audDot.classList.add("on");
};
const stopDemo = () => {
  if (demo) {
    demo.kill();
    demo = null;
  }
};
const normPt = (e: PointerEvent): [number, number] => {
  const r = preCv.getBoundingClientRect();
  return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)];
};
preCv.addEventListener("pointerdown", (e) => {
  if (e.button > 0) return;
  preCv.setPointerCapture(e.pointerId);
  stopDemo();
  const q = normPt(e);
  stroke = { tool, board, p: [q] };
  (inks[inkKey()] = inks[inkKey()] ?? []).push(stroke);
  moveDot(q);
  paintInk();
});
preCv.addEventListener("pointermove", (e) => {
  const q = normPt(e);
  moveDot(q);
  if (!stroke) return;
  const l = stroke.p[stroke.p.length - 1];
  if (Math.hypot((q[0] - l[0]) * preCv.width, (q[1] - l[1]) * preCv.height) < 2) return;
  stroke.p.push(q);
  paintInk();
});
const endStroke = () => {
  stroke = null;
};
preCv.addEventListener("pointerup", endStroke);
preCv.addEventListener("pointercancel", endStroke);
preCv.addEventListener("pointerleave", () => {
  if (!stroke) audDot.classList.remove("on");
});
$$<HTMLButtonElement>(".tool[data-tool]").forEach((b) =>
  b.addEventListener("click", () => {
    tool = b.dataset.tool ?? "pen";
    $$(".tool[data-tool]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  }),
);
$("#presBoard").addEventListener("click", (e) => {
  stopDemo();
  board = !board;
  pres.classList.toggle("boarded", board);
  (e.currentTarget as HTMLElement).setAttribute("aria-pressed", String(board));
  paintInk();
});
$("#presClear").addEventListener("click", () => {
  stopDemo();
  inks[inkKey()] = [];
  paintInk();
});
const turn = (d: number) => {
  stopDemo();
  page = clamp(page + d, 0, slides.length - 1);
  renderSlides();
};
$("#presPrev").addEventListener("click", () => turn(-1));
$("#presNext").addEventListener("click", () => turn(1));
renderSlides();
if (window.ResizeObserver) new ResizeObserver(fitInk).observe(preCv);
else {
  fitInk();
  addEventListener("resize", fitInk);
}
const demoPts = () => {
  const p: Array<[number, number]> = [];
  for (let i = 0; i <= 72; i++) {
    const a = -2.2 + (i / 72) * Math.PI * 2.18;
    const j = 1 + Math.sin(i * 0.9) * 0.02;
    p.push([0.205 + Math.cos(a) * 0.16 * j, 0.715 + Math.sin(a) * 0.15 * j]);
  }
  return p;
};
function playDemo() {
  if (page !== 0 || board || inks.p0?.length) return;
  const pts = demoPts();
  const k: Stroke = { tool: "pen", board: false, p: [] };
  inks.p0 = [k];
  if (still) {
    k.p = pts;
    paintInk();
    return;
  }
  const o = { v: 0 };
  demo = gsap.to(o, {
    v: pts.length,
    duration: 1.5,
    ease: "power1.inOut",
    delay: 0.5,
    onUpdate: () => {
      k.p = pts.slice(0, Math.max(1, Math.round(o.v)));
      moveDot(k.p[k.p.length - 1]);
      paintInk();
    },
    onComplete: () => {
      demo = null;
      setTimeout(() => audDot.classList.remove("on"), 900);
    },
  });
}
let clockT = 0;
let secs = 12 * 60 + 40;
const clockEl = $("#presClock");
const showClock = () => {
  clockEl.textContent = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
};
showClock();
inView(pres, (on) => {
  if (on && !clockT)
    clockT = window.setInterval(() => {
      secs++;
      showClock();
    }, 1000);
  else if (!on && clockT) {
    clearInterval(clockT);
    clockT = 0;
  }
});
inView(
  pres,
  (on) => {
    if (on) playDemo();
  },
  { threshold: 0.45 },
);

const dlg = $("#tplDlg");
const holder = $("#tplHolder");
const tplName = $<HTMLInputElement>("#tplName");
const swatches = $$<HTMLButtonElement>(".swatch");
let tplOpener: HTMLElement | null = null;
let tplKey: TemplateKey = "cv";
let tplSrc: HTMLElement | null = null;
function fitHolder() {
  const st = $(".tpl-stage");
  const el = holder.firstElementChild as HTMLElement | null;
  if (!el) return 1;
  const k = Math.min((st.clientWidth - 56) / el.offsetWidth, (st.clientHeight - 56) / el.offsetHeight, 2.6);
  holder.style.transform = `translate(-50%,-50%) scale(${k.toFixed(3)})`;
  return k;
}
function setSwatch(sw: HTMLButtonElement) {
  swatches.forEach((x) => {
    const on = x === sw;
    x.setAttribute("aria-checked", String(on));
    x.tabIndex = on ? 0 : -1;
  });
  holder.className = `tpl-holder${sw.dataset.p ? ` ${sw.dataset.p}` : ""}`;
}
function openTpl(k: TemplateKey, src: HTMLElement | null, from: HTMLElement | null) {
  tplOpener = from;
  tplKey = k;
  tplSrc = src;
  holder.innerHTML = data.templates[k];
  setSwatch(swatches[0]);
  const m = data.tplMeta[k];
  const tgt = holder.querySelector(m[1]);
  $("#tplTitle").textContent = m[0];
  $("#tplNameLabel").textContent = m[2];
  tplName.value = tgt ? (tgt.textContent ?? "") : "";
  dlg.hidden = false;
  root.classList.add("no-scroll");
  lenis?.stop();
  const sc = fitHolder();
  const focusIn = () => tplName.focus({ preventScroll: true });
  if (still) {
    focusIn();
    return;
  }
  gsap.fromTo(".tpl-scrim", { opacity: 0 }, { opacity: 1, duration: 0.5, ease: "power2.out" });
  gsap.fromTo(".tpl-panel", { opacity: 0, y: 28, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: 0.75, ease: "expo.out" });
  if (!src) {
    focusIn();
    return;
  }
  const sr = src.getBoundingClientRect();
  const el = holder.firstElementChild as HTMLElement;
  const hr = el.getBoundingClientRect();
  const w = src.offsetWidth;
  const h = src.offsetHeight;
  const fly = src.cloneNode(true) as HTMLElement;
  fly.classList.add("tpl-fly");
  fly.style.width = `${w}px`;
  fly.style.height = `${h}px`;
  document.body.appendChild(fly);
  src.style.visibility = "hidden";
  holder.style.opacity = "0";
  gsap.fromTo(
    fly,
    { x: sr.left, y: sr.top, scaleX: sr.width / w, scaleY: sr.height / h, rotation: -8 },
    {
      x: hr.left,
      y: hr.top,
      scaleX: sc,
      scaleY: sc,
      rotation: 0,
      duration: 0.95,
      ease: "expo.inOut",
      onComplete: () => {
        holder.style.opacity = "";
        fly.remove();
        focusIn();
      },
    },
  );
}
function closeTpl(instant: boolean) {
  if (dlg.hidden) return;
  const done = () => {
    dlg.hidden = true;
    root.classList.remove("no-scroll");
    lenis?.start();
    if (tplSrc) tplSrc.style.visibility = "";
    $$(".tpl-fly").forEach((f) => f.remove());
    holder.style.opacity = "";
    tplOpener?.focus({ preventScroll: true });
  };
  if (instant || still) {
    done();
    return;
  }
  gsap.to([".tpl-panel", ".tpl-scrim"], {
    opacity: 0,
    duration: 0.22,
    ease: "power2.in",
    onComplete: () => {
      gsap.set([".tpl-panel", ".tpl-scrim"], { clearProps: "opacity,transform" });
      done();
    },
  });
}
tplName.addEventListener("input", () => {
  const t = holder.querySelector(data.tplMeta[tplKey][1]);
  if (t) t.textContent = tplName.value.trim() || " ";
});
swatches.forEach((sw) => {
  sw.addEventListener("click", () => setSwatch(sw));
  sw.addEventListener("keydown", (e) => {
    const i = swatches.indexOf(sw);
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = swatches[(i + d + swatches.length) % swatches.length];
    setSwatch(n);
    n.focus();
  });
});
dlg.addEventListener("click", (e) => {
  const target = e.target as Element;
  const go = target.closest<HTMLAnchorElement>("[data-close-go]");
  if (go) {
    e.preventDefault();
    closeTpl(true);
    const t = $(go.hash);
    if (lenis) lenis.scrollTo(t, { offset: -90 });
    else t.scrollIntoView();
    return;
  }
  if (target.closest("[data-close]")) {
    e.preventDefault();
    closeTpl(false);
  }
});
dlg.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    closeTpl(false);
    return;
  }
  if (e.key !== "Tab") return;
  const f = $$<HTMLElement>("button,input,a[href]", dlg).filter((x) => !(x as HTMLButtonElement).disabled && x.tabIndex >= 0 && x.offsetParent !== null);
  const first = f[0];
  const last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});
addEventListener("resize", () => {
  if (!dlg.hidden) fitHolder();
});
$("#wall").addEventListener("click", (e) => {
  const tp = (e.target as Element).closest<HTMLElement>(".tp");
  if (tp?.dataset.t) openTpl(tp.dataset.t as TemplateKey, tp, null);
});
$$<HTMLButtonElement>(".chip[data-t]").forEach((c) =>
  c.addEventListener("click", () => {
    const k = c.dataset.t as TemplateKey;
    const cx0 = innerWidth / 2;
    const cy0 = innerHeight / 2;
    const near = $$(`.wall .tp[data-t="${k}"]`)
      .map((el) => [el, el.getBoundingClientRect()] as const)
      .filter(([, r]) => r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth)
      .sort((a, b) => Math.hypot(a[1].left + a[1].width / 2 - cx0, a[1].top - cy0) - Math.hypot(b[1].left + b[1].width / 2 - cx0, b[1].top - cy0))[0];
    openTpl(k, near ? near[0] : null, c);
  }),
);

const omr = $("#omr");
const omrN = $("#omrN");
function playOmr() {
  omr.classList.add("reset");
  omr.classList.remove("is-on");
  void omr.offsetWidth;
  omr.classList.remove("reset");
  void omr.offsetWidth;
  omr.classList.add("is-on");
  if (still) {
    omrN.textContent = "4";
    return;
  }
  const o = { v: 0 };
  omrN.textContent = "0";
  gsap.to(o, {
    v: 4,
    duration: 1.3,
    delay: 0.25,
    ease: "power1.out",
    onUpdate: () => {
      omrN.textContent = String(Math.round(o.v));
    },
  });
}
$("#omrAgain").addEventListener("click", playOmr);

const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
const plat = nav.userAgentData?.platform || navigator.platform || "";
if (/mac/i.test(plat) && !/iphone|ipad/i.test(navigator.userAgent)) $("#dlCols").classList.add("mac");

function samePageHash(a: HTMLAnchorElement) {
  return a.hash.length > 1 && a.pathname === location.pathname && !a.hasAttribute("data-close-go");
}
const anchors = $$<HTMLAnchorElement>("a[href*='#']").filter(samePageHash);
const brands = $$<HTMLAnchorElement>("a.brand").filter((a) => a.pathname === location.pathname);

if (still) {
  omr.classList.add("is-on");
  anchors.forEach((a) =>
    a.addEventListener("click", (e) => {
      const t = document.getElementById(decodeURIComponent(a.hash.slice(1)));
      if (!t) return;
      e.preventDefault();
      t.scrollIntoView();
      history.replaceState(null, "", a.hash);
    }),
  );
} else {
  gsap.registerPlugin(ScrollTrigger);
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  if (!location.hash) window.scrollTo(0, 0);
  if (!isLite()) {
    lenis = new Lenis({ duration: 1.15, smoothWheel: true });
    lenis.on("scroll", ScrollTrigger.update);
  }
  gsap.ticker.add((t) => lenis?.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  const tourEl = $(".tour");
  const goTo = (t: HTMLElement, immediate: boolean) => {
    const offset = t === tourEl && !stackedTour.matches ? window.innerHeight * 0.9 : -90;
    if (lenis) lenis.scrollTo(t, { offset, immediate });
    else window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY + offset, behavior: immediate ? "instant" : "smooth" });
  };
  anchors.forEach((a) =>
    a.addEventListener("click", (e) => {
      const t = document.getElementById(decodeURIComponent(a.hash.slice(1)));
      if (!t) return;
      e.preventDefault();
      goTo(t, false);
      history.replaceState(null, "", a.hash);
    }),
  );
  brands.forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      if (lenis) lenis.scrollTo(0);
      else scrollTo({ top: 0 });
      history.replaceState(null, "", location.pathname);
    }),
  );

  const h1 = $("#heroTitle");
  const reveal = gsap.timeline({ paused: true });
  reveal
    .fromTo(".nav", { autoAlpha: 0, y: -18 }, { autoAlpha: 1, y: 0, duration: 0.9, ease: "expo.out" }, 0)
    .fromTo(".news", { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.9, ease: "expo.out" }, 0.05)
    .set(".proof", { autoAlpha: 1 }, 0)
    .fromTo(".proof li", { autoAlpha: 0, x: -14 }, { autoAlpha: 1, x: 0, duration: 0.8, ease: "expo.out", stagger: 0.08 }, 0.14)
    .set(h1, { autoAlpha: 1 }, 0)
    .fromTo(".ln>span", { yPercent: 115 }, { yPercent: 0, duration: 1, ease: "expo.out", stagger: 0.07 }, 0.04)
    .fromTo([".lede", ".cta"], { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.8, ease: "expo.out", stagger: 0.06 }, 0.22)
    .fromTo(".hero-foot", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.8, ease: "power2.out" }, 0.45);
  reveal.delay(0.1).play();
  const scrubMark = () =>
    gsap.to(".hero-mark", { yPercent: -40, scale: 0.55, rotation: -8, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: 0.5 } });
  vp.fallback = () => {
    if (vp.started) return;
    vp.started = true;
    clearTimeout(vp.timer);
    root.classList.add("no-gl");
    const tl = gsap.timeline();
    tl.fromTo(".hero-mark .gl", { xPercent: -34, yPercent: -16, rotation: -14 }, { xPercent: 0, yPercent: 0, rotation: 0, duration: 1.5, ease: "elastic.out(1,.62)" }, 0)
      .fromTo(".hero-mark .gr", { xPercent: 36, yPercent: 18, rotation: 16 }, { xPercent: 0, yPercent: 0, rotation: 0, duration: 1.5, ease: "elastic.out(1,.62)" }, 0.07)
      .fromTo(".hero-mark .gf", { xPercent: 24, yPercent: -34, rotation: 30 }, { xPercent: 0, yPercent: 0, rotation: 0, duration: 1.5, ease: "elastic.out(1,.62)" }, 0.15);
    vp.intro = tl;
    scrubMark();
  };
  addEventListener(
    "vp:lite",
    () => {
      lenis?.destroy();
      lenis = null;
      if (!root.classList.contains("gl-on")) return;
      root.classList.remove("gl-on");
      root.classList.add("no-gl");
      scrubMark();
    },
    { once: true },
  );
  vp.timer = window.setTimeout(() => {
    if (!vp.started) vp.fallback();
  }, 4200);
  const skip = () => {
    if (vp.intro && vp.intro.progress() < 1) vp.intro.progress(1);
    if (vp.started && reveal.progress() < 1) reveal.progress(1);
  };
  ["wheel", "touchstart", "keydown"].forEach((t) => addEventListener(t, skip, { once: true, passive: true }));

  const conn = navigator as Navigator & { connection?: { saveData?: boolean } };
  const wantsGl = matchMedia("(min-width:960px)").matches && !conn.connection?.saveData && !isLite();
  if (wantsGl && softwareRendering()) enableLite();
  if (wantsGl && !isLite()) {
    import("./glass")
      .then((m) => m.boot())
      .catch(() => {
        root.classList.remove("gl-on");
        vp.fallback();
      });
  } else vp.fallback();

  ScrollTrigger.create({ trigger: ".hero", start: "top top", end: "bottom top", onUpdate: (s) => (vp.heroP = s.progress) });
  ScrollTrigger.create({
    trigger: ".tour",
    start: "top 80px",
    onToggle: (s) => $(".nav").classList.toggle("solid", s.isActive || s.progress > 0),
    onLeaveBack: () => $(".nav").classList.remove("solid"),
    onEnter: () => $(".nav").classList.add("solid"),
  });
  gsap.fromTo(".win-wrap", { rotationX: 24, y: 110, scale: 0.9 }, { rotationX: 0, y: 0, scale: 1, ease: "none", scrollTrigger: { trigger: ".tour", start: "top bottom", end: "top top", scrub: 0.6 } });
  gsap.matchMedia().add("(min-width:960px)", () => {
    ScrollTrigger.create({
      trigger: ".tour",
      start: "top top",
      end: "bottom bottom",
      onUpdate: (s) => {
        win.style.setProperty("--tp", s.progress.toFixed(3));
        setGroup(Math.min(order.length - 1, Math.floor(s.progress * order.length)));
      },
    });
  });

  const tilt = $(".tilt");
  if (matchMedia("(hover:hover) and (pointer:fine)").matches) {
    const rx = gsap.quickTo(tilt, "rotationX", { duration: 0.9, ease: "power3" });
    const ry = gsap.quickTo(tilt, "rotationY", { duration: 0.9, ease: "power3" });
    addEventListener(
      "pointermove",
      (e) => {
        const r = win.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight) return;
        const nx = e.clientX / innerWidth - 0.5;
        const ny = e.clientY / innerHeight - 0.5;
        ry(nx * 7);
        rx(-ny * 5);
      },
      { passive: true },
    );
    $$(".magnetic").forEach((b) => {
      const qx = gsap.quickTo(b, "x", { duration: 0.6, ease: "power3" });
      const qy = gsap.quickTo(b, "y", { duration: 0.6, ease: "power3" });
      b.addEventListener("pointermove", (e) => {
        const r = b.getBoundingClientRect();
        qx(clamp((e.clientX - r.left - r.width / 2) * 0.22, -10, 10));
        qy(clamp((e.clientY - r.top - r.height / 2) * 0.32, -8, 8));
      });
      b.addEventListener("pointerleave", () => {
        qx(0);
        qy(0);
      });
    });
  }

  gsap.set("#wall", { rotationX: 46, rotationZ: -12 });
  gsap.to("#wall", { rotationX: 30, ease: "none", scrollTrigger: { trigger: ".wall-stage", start: "top bottom", end: "bottom top", scrub: 0.6 } });
  gsap.fromTo(".dl-mark", { yPercent: 30, rotation: -10 }, { yPercent: -10, rotation: 6, ease: "none", scrollTrigger: { trigger: ".dl-sec", start: "top bottom", end: "bottom top", scrub: 0.6 } });

  document.fonts?.ready.then(() => ScrollTrigger.refresh());
  ScrollTrigger.batch("[data-reveal]", {
    start: "top 98%",
    once: true,
    onEnter: (b) => {
      const vis = b.filter((e) => e.getBoundingClientRect().bottom > 0);
      gsap.set(
        b.filter((e) => !vis.includes(e)),
        { autoAlpha: 1, y: 0 },
      );
      gsap.fromTo(vis, { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: "power3.out", stagger: { amount: Math.min(0.16, vis.length * 0.04) }, overwrite: true });
    },
  });
  ScrollTrigger.create({ trigger: omr, start: "top 75%", once: true, onEnter: playOmr });
  inView(lens, (on) => {
    L.on = on;
    if (on) {
      gsap.ticker.remove(lensFrame);
      gsap.ticker.add(lensFrame);
    } else gsap.ticker.remove(lensFrame);
  });
  $$("[data-count]").forEach((b) => {
    const n = Number(b.dataset.count);
    const o = { v: 0 };
    b.textContent = "0";
    ScrollTrigger.create({
      trigger: b,
      start: "top 90%",
      once: true,
      onEnter: () =>
        gsap.to(o, {
          v: n,
          duration: 1.6,
          ease: "power3.out",
          onUpdate: () => {
            b.textContent = String(Math.round(o.v));
          },
        }),
    });
  });
  gsap.set("#rel", { "--relp": 0 });
  ScrollTrigger.create({
    trigger: "#rel",
    start: "top 85%",
    once: true,
    onEnter: () => {
      gsap.to("#rel", { "--relp": 1, duration: 1.8, ease: "power2.inOut" });
      gsap.fromTo("#rel li", { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: "expo.out", stagger: 0.14 });
    },
  });
  ScrollTrigger.create({
    trigger: cmp,
    start: "top 75%",
    once: true,
    onEnter: () => {
      const p = { v: 50 };
      const up = () => {
        range.value = String(p.v);
        setSplit(p.v);
      };
      gsap.timeline().to(p, { v: 80, duration: 1.1, ease: "power2.inOut", onUpdate: up }).to(p, { v: 24, duration: 1.4, ease: "power2.inOut", onUpdate: up }).to(p, { v: 50, duration: 1, ease: "power2.inOut", onUpdate: up });
    },
  });
  if (location.hash) {
    const t = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (t) requestAnimationFrame(() => goTo(t, true));
  }
}
