import type { MountOptions, Unmount } from "../viewer/mount";

const ASSET_BASE = import.meta.url.slice(0, import.meta.url.lastIndexOf("/") + 1);
const HOST_STYLE = ":host{display:block;position:relative;height:600px;contain:strict}";

export type LoadMode = "range" | "full";

export type MarkDetail = { name: string; time: number };

export class VivePdfElement extends HTMLElement {
  private readonly root: ShadowRoot;
  private unmount: Unmount | null = null;
  private observer: IntersectionObserver | null = null;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(HOST_STYLE);
    this.root.adoptedStyleSheets = [sheet];
  }

  connectedCallback(): void {
    this.mark("connected");
    this.observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      this.observer?.disconnect();
      this.observer = null;
      void this.boot();
    }, { rootMargin: "200px" });
    this.observer.observe(this);
  }

  disconnectedCallback(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.unmount?.();
    this.unmount = null;
  }

  private async boot(): Promise<void> {
    const src = this.getAttribute("src");
    if (!src) return;
    const { mount } = await import("../viewer/mount");
    this.mark("viewer-loaded");
    if (!this.isConnected) return;
    const options: MountOptions = {
      src: new URL(src, document.baseURI).href,
      mode: this.getAttribute("load") === "full" ? "full" : "range",
      wasmUrl: new URL("pdfium.wasm", ASSET_BASE).href,
      mark: (name) => this.mark(name),
    };
    this.unmount = mount(this.root, options);
  }

  private mark(name: string): void {
    this.dispatchEvent(new CustomEvent<MarkDetail>("vive-mark", { detail: { name, time: performance.now() } }));
  }
}

if (!customElements.get("vive-pdf")) customElements.define("vive-pdf", VivePdfElement);
