import { parseMode, parsePageSetting, parseSourceUrl, parseZoomSetting } from "../api/parse";
import type { VivePdfInput, VivePdfOpenError, VivePdfViewer, ZoomSetting } from "../api/types";
import { parseFontBase } from "../engine/fontBase";
import { resolveLang } from "../i18n/lang";
import { parseThemeSetting } from "../styles/theme";
import type { ViewerCommand, ViewerEvent, ViewerSource } from "../viewer/bridge";
import { parseOptIn, parseSwitch } from "../viewer/features";
import type { MountOptions, ViewerHandle } from "../viewer/mount";

type ViewerModule = { mount: (root: ShadowRoot, options: MountOptions) => ViewerHandle };
type Waiter = { resolve: () => void; reject: (error: VivePdfOpenError) => void };
type OpenedData = { blob: Blob; name: string | null };

const ASSET_BASE = import.meta.url.slice(0, import.meta.url.lastIndexOf("/") + 1);
const HOST_STYLE = ':host{display:block;position:relative;height:600px;contain:strict}:host([mode="full" i]){height:100vh;height:100dvh}:host([mode="inline" i]){height:auto;contain:layout style}:host([mode="lightbox" i]){display:contents}';
const ACCENT_PROPERTY = "--vp-accent";

export type MarkDetail = { name: string; time: number };

export class VivePdfElement extends HTMLElement implements VivePdfViewer {
  static readonly observedAttributes = ["mode", "src", "load", "page", "zoom", "accent", "theme", "lang", "fonts", "print", "download", "toolbar", "search", "branding", "annotate", "filename"];

  private readonly root: ShadowRoot;
  private handle: ViewerHandle | null = null;
  private observer: IntersectionObserver | null = null;
  private visible = false;
  private booting = false;
  private queued: ViewerCommand[] = [];
  private data: OpenedData | null = null;
  private objectUrl: string | null = null;
  private source: ViewerSource | null = null;
  private waiters: Waiter[] = [];
  private shown = false;
  private current = { page: 0, pageCount: 0, zoom: 0 };
  private readonly emit = (event: ViewerEvent) => this.receive(event);
  private readonly markEvent = (name: string) => this.mark(name);

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(HOST_STYLE);
    this.root.adoptedStyleSheets = [sheet];
  }

  get page(): number {
    return this.current.page;
  }

  get pageCount(): number {
    return this.current.pageCount;
  }

  get zoom(): number {
    return this.current.zoom;
  }

  connectedCallback(): void {
    this.mark("connected");
    this.observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      this.observer?.disconnect();
      this.observer = null;
      this.visible = true;
      void this.boot();
    }, { rootMargin: "200px" });
    this.observer.observe(this);
  }

  disconnectedCallback(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.visible = false;
    this.handle?.unmount();
    this.handle = null;
    this.source = null;
    this.releaseObjectUrl();
  }

  attributeChangedCallback(name: string, previous: string | null, value: string | null): void {
    if (previous === value && name !== "src") return;
    if (name === "accent") this.applyAccent(value);
    else if (name === "page") {
      const page = parsePageSetting(value);
      if (page !== null && this.source) this.command({ kind: "goTo", page });
    } else if (name === "zoom") {
      const zoom = parseZoomSetting(value);
      if (zoom !== null && this.source) this.command({ kind: "zoom", zoom });
    } else if (name === "src" || name === "load") {
      if (name === "src") this.forgetData();
      this.changeSource();
    } else {
      if (name === "mode" && parseMode(value) !== "lightbox") this.shown = false;
      const options = this.handle ? this.options() : null;
      if (options) this.handle?.update(options);
    }
  }

  open(input: VivePdfInput): Promise<void> {
    const opened = new Promise<void>((resolve, reject) => {
      this.settleWaiters("replaced");
      this.waiters.push({ resolve, reject });
    });
    if (typeof input === "string" || input instanceof URL) {
      this.show();
      this.forgetData();
      this.setAttribute("src", String(input));
      return opened;
    }
    this.show();
    this.forgetData();
    const blob = input instanceof Blob ? input : new Blob([input as BlobPart], { type: "application/pdf" });
    this.data = { blob, name: input instanceof File ? input.name : null };
    this.changeSource();
    return opened;
  }

  goTo(page: number): void {
    const target = parsePageSetting(page);
    if (target !== null) this.command({ kind: "goTo", page: target });
  }

  setZoom(zoom: ZoomSetting): void {
    const target = parseZoomSetting(zoom);
    if (target !== null) this.command({ kind: "zoom", zoom: target });
  }

  search(query: string): void {
    this.command({ kind: "search", query: String(query) });
  }

  print(): void {
    this.command({ kind: "print" });
  }

  download(): void {
    this.command({ kind: "download" });
  }

  show(): void {
    if (parseMode(this.getAttribute("mode")) !== "lightbox") return;
    this.shown = true;
    this.visible = true;
    if (this.handle) this.handle.show();
    else void this.boot();
  }

  close(): void {
    this.shown = false;
    this.handle?.close();
  }

  private changeSource(): void {
    this.source = null;
    this.current = { page: 0, pageCount: 0, zoom: 0 };
    this.queued = [];
    const src = this.getAttribute("src");
    if (!this.data && src && !parseSourceUrl(src, document.baseURI)) this.receive({ type: "error", detail: { code: "unsupported-url" } });
    if (!this.handle) {
      void this.boot();
      return;
    }
    const options = this.options();
    if (options) {
      this.handle.update(options);
      this.queueStartZoom();
    } else {
      this.handle.unmount();
      this.handle = null;
    }
  }

  private resolveSource(): ViewerSource | null {
    if (this.source) return this.source;
    if (this.data) {
      this.objectUrl ??= URL.createObjectURL(this.data.blob);
      this.source = { kind: "data", data: this.data.blob, url: this.objectUrl };
      return this.source;
    }
    const src = this.getAttribute("src");
    const url = src ? parseSourceUrl(src, document.baseURI) : null;
    if (!url) return null;
    this.source = { kind: "url", url, load: this.getAttribute("load") === "full" ? "full" : "range" };
    return this.source;
  }

  private options(): MountOptions | null {
    const source = this.resolveSource();
    if (!source) return null;
    return {
      source,
      mode: parseMode(this.getAttribute("mode")),
      startPage: parsePageSetting(this.getAttribute("page")) ?? 1,
      assetBase: this.assetBase(),
      lang: resolveLang(this.getAttribute("lang"), document.documentElement.lang),
      theme: parseThemeSetting(this.getAttribute("theme")),
      fontBase: parseFontBase(this.getAttribute("fonts"), document.baseURI),
      features: {
        print: parseSwitch(this.getAttribute("print")),
        download: parseSwitch(this.getAttribute("download")),
        toolbar: parseSwitch(this.getAttribute("toolbar")),
        search: parseSwitch(this.getAttribute("search")),
        branding: parseSwitch(this.getAttribute("branding")),
        annotate: parseOptIn(this.getAttribute("annotate")),
      },
      fileName: this.getAttribute("filename") ?? this.data?.name ?? null,
      mark: this.markEvent,
      emit: this.emit,
    };
  }

  private assetBase(): string {
    const assets = this.getAttribute("assets")?.trim();
    return assets ? new URL(assets.endsWith("/") ? assets : `${assets}/`, document.baseURI).href : ASSET_BASE;
  }

  private async boot(): Promise<void> {
    if (!this.visible || this.handle || this.booting || !this.resolveSource()) return;
    this.booting = true;
    const { mount } = (await import(/* @vite-ignore */ new URL("viewer.js", this.assetBase()).href)) as ViewerModule;
    this.booting = false;
    this.mark("viewer-loaded");
    const options = this.isConnected && this.visible ? this.options() : null;
    if (!options || this.handle) return;
    this.handle = mount(this.root, options);
    if (this.shown) this.handle.show();
    this.queueStartZoom();
    const queued = this.queued;
    this.queued = [];
    for (const command of queued) this.handle.command(command);
  }

  private queueStartZoom(): void {
    const zoom = parseZoomSetting(this.getAttribute("zoom"));
    if (zoom !== null) this.handle?.command({ kind: "zoom", zoom });
  }

  private command(command: ViewerCommand): void {
    if (this.handle) this.handle.command(command);
    else this.queued.push(command);
  }

  private receive(event: ViewerEvent): void {
    if (event.type === "ready") {
      this.current.pageCount = event.detail.pageCount;
      this.settleWaiters(null);
    } else if (event.type === "pagechange") {
      this.current.page = event.detail.page;
      this.current.pageCount = event.detail.pageCount;
    } else if (event.type === "zoomchange") this.current.zoom = event.detail.zoom;
    else if (event.type === "close") this.shown = false;
    else this.settleWaiters(event.detail.code);
    this.dispatchEvent(new CustomEvent(`vive-${event.type}`, { detail: event.detail, bubbles: true, composed: true }));
  }

  private settleWaiters(code: VivePdfOpenError["code"] | null): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) {
      if (code === null) waiter.resolve();
      else waiter.reject(Object.assign(new Error(`vive-pdf could not open the document: ${code}`), { code }));
    }
  }

  private forgetData(): void {
    this.data = null;
    this.releaseObjectUrl();
  }

  private releaseObjectUrl(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  private applyAccent(value: string | null): void {
    if (value && CSS.supports("color", value)) this.style.setProperty(ACCENT_PROPERTY, value);
    else this.style.removeProperty(ACCENT_PROPERTY);
  }

  private mark(name: string): void {
    this.dispatchEvent(new CustomEvent<MarkDetail>("vive-mark", { detail: { name, time: performance.now() } }));
  }
}

if (!customElements.get("vive-pdf")) customElements.define("vive-pdf", VivePdfElement);
