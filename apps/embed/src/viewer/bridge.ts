import type { VivePdfErrorCode, VivePdfPageChangeDetail, VivePdfReadyDetail, VivePdfZoomChangeDetail, ZoomSetting } from "../api/types";

export type ViewerSource = { kind: "url"; url: string; load: "range" | "full" } | { kind: "data"; data: Blob; url: string };

export type ViewerCommand =
  | { kind: "goTo"; page: number }
  | { kind: "zoom"; zoom: ZoomSetting }
  | { kind: "search"; query: string }
  | { kind: "print" }
  | { kind: "download" };

export type ViewerEvent =
  | { type: "ready"; detail: VivePdfReadyDetail }
  | { type: "pagechange"; detail: VivePdfPageChangeDetail }
  | { type: "zoomchange"; detail: VivePdfZoomChangeDetail }
  | { type: "error"; detail: { code: VivePdfErrorCode } }
  | { type: "close"; detail: null };
