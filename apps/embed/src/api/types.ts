export type ZoomSetting = number | "fit-width" | "fit-page";

export type VivePdfMode = "sized" | "inline" | "full" | "lightbox";

export type VivePdfErrorCode = "password" | "wrong-password" | "not-found" | "network" | "damaged" | "no-pages" | "engine" | "unsupported-url" | "unknown";

export type VivePdfInput = string | URL | Blob | ArrayBuffer | ArrayBufferView;

export type VivePdfReadyDetail = { pageCount: number };
export type VivePdfPageChangeDetail = { page: number; pageCount: number };
export type VivePdfZoomChangeDetail = { zoom: number };
export type VivePdfErrorDetail = { code: VivePdfErrorCode };

export type VivePdfEventMap = {
  "vive-ready": CustomEvent<VivePdfReadyDetail>;
  "vive-pagechange": CustomEvent<VivePdfPageChangeDetail>;
  "vive-zoomchange": CustomEvent<VivePdfZoomChangeDetail>;
  "vive-error": CustomEvent<VivePdfErrorDetail>;
  "vive-close": CustomEvent<null>;
};

export type VivePdfOpenError = Error & { code: VivePdfErrorCode | "replaced" };

export interface VivePdfViewer extends HTMLElement {
  readonly page: number;
  readonly pageCount: number;
  readonly zoom: number;
  open(input: VivePdfInput): Promise<void>;
  goTo(page: number): void;
  setZoom(zoom: ZoomSetting): void;
  search(query: string): void;
  print(): void;
  download(): void;
  show(): void;
  close(): void;
  addEventListener<K extends keyof VivePdfEventMap>(type: K, listener: (this: VivePdfViewer, event: VivePdfEventMap[K]) => void, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
  removeEventListener<K extends keyof VivePdfEventMap>(type: K, listener: (this: VivePdfViewer, event: VivePdfEventMap[K]) => void, options?: boolean | EventListenerOptions): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
}

declare global {
  interface HTMLElementTagNameMap {
    "vive-pdf": VivePdfViewer;
  }
}
