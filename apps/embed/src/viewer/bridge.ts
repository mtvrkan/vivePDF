import type {
  VivePdfAnnotateError,
  VivePdfAnnotation,
  VivePdfAnnotationChangeDetail,
  VivePdfErrorCode,
  VivePdfPageChangeDetail,
  VivePdfReadyDetail,
  VivePdfTool,
  VivePdfZoomChangeDetail,
  ZoomSetting,
} from "../api/types";
import type { CommandQueue } from "./commandQueue";

export type ViewerSource = { kind: "url"; url: string; load: "range" | "full" } | { kind: "data"; data: Blob; url: string };

export type Reply<T> = { resolve: (value: T) => void; reject: (error: VivePdfAnnotateError) => void };

export type AnnotateCommand =
  | { kind: "annotations"; reply: Reply<VivePdfAnnotation[]> }
  | { kind: "setAnnotations"; list: unknown; reply: Reply<void> }
  | { kind: "save"; reply: Reply<Blob> }
  | { kind: "setTool"; tool: VivePdfTool | null };

export type AnnotateApi = {
  list: () => VivePdfAnnotation[];
  replace: (list: unknown) => void;
  save: () => Promise<Blob>;
  chooseTool: (tool: VivePdfTool | null) => void;
};

export type ViewCommand = { kind: "goTo"; page: number } | { kind: "zoom"; zoom: ZoomSetting } | { kind: "search"; query: string } | { kind: "print" } | { kind: "download" };

export type ViewerCommand = ViewCommand | AnnotateCommand;

export type ViewerQueues = { view: CommandQueue<ViewCommand>; annotate: CommandQueue<AnnotateCommand> };

export type ViewerEvent =
  | { type: "ready"; detail: VivePdfReadyDetail }
  | { type: "pagechange"; detail: VivePdfPageChangeDetail }
  | { type: "zoomchange"; detail: VivePdfZoomChangeDetail }
  | { type: "error"; detail: { code: VivePdfErrorCode } }
  | { type: "close"; detail: null }
  | { type: "annotationchange"; detail: VivePdfAnnotationChangeDetail };
