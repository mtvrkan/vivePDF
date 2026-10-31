export type ZoomSetting = number | "fit-width" | "fit-page";

export type VivePdfMode = "sized" | "inline" | "full" | "lightbox";

export type VivePdfErrorCode = "password" | "wrong-password" | "not-found" | "network" | "damaged" | "no-pages" | "engine" | "unsupported-url" | "unknown";

export type VivePdfInput = string | URL | Blob | ArrayBuffer | ArrayBufferView;

export type VivePdfTool = "pen" | "marker" | "highlight" | "underline" | "strikeout" | "note" | "rectangle" | "ellipse" | "arrow";

export type VivePdfPoint = { x: number; y: number };
export type VivePdfBox = { x: number; y: number; width: number; height: number };

type VivePdfAnnotationBase = { page: number; color: string; opacity?: number; text?: string };

export type VivePdfAnnotation =
  | (VivePdfAnnotationBase & { type: "pen" | "marker"; width: number; strokes: VivePdfPoint[][] })
  | (VivePdfAnnotationBase & { type: "highlight" | "underline" | "strikeout"; boxes: VivePdfBox[] })
  | (VivePdfAnnotationBase & { type: "note"; box: VivePdfBox })
  | (VivePdfAnnotationBase & { type: "rectangle" | "ellipse"; width: number; box: VivePdfBox })
  | (VivePdfAnnotationBase & { type: "line" | "arrow"; width: number; from: VivePdfPoint; to: VivePdfPoint });

export type VivePdfAnnotateErrorCode = "annotate-off" | "not-ready" | "invalid" | "replaced" | "failed";

export type VivePdfAnnotateError = Error & { code: VivePdfAnnotateErrorCode };

export type VivePdfReadyDetail = { pageCount: number };
export type VivePdfPageChangeDetail = { page: number; pageCount: number };
export type VivePdfZoomChangeDetail = { zoom: number };
export type VivePdfErrorDetail = { code: VivePdfErrorCode };
export type VivePdfAnnotationChangeDetail = { type: "create" | "update" | "delete"; page: number };

export type VivePdfEventMap = {
  "vive-ready": CustomEvent<VivePdfReadyDetail>;
  "vive-pagechange": CustomEvent<VivePdfPageChangeDetail>;
  "vive-zoomchange": CustomEvent<VivePdfZoomChangeDetail>;
  "vive-error": CustomEvent<VivePdfErrorDetail>;
  "vive-close": CustomEvent<null>;
  "vive-annotationchange": CustomEvent<VivePdfAnnotationChangeDetail>;
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
  annotations(): Promise<VivePdfAnnotation[]>;
  setAnnotations(list: readonly VivePdfAnnotation[]): Promise<void>;
  save(): Promise<Blob>;
  setTool(tool: VivePdfTool | null): void;
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
