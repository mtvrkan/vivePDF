import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { extensionOf } from "@/shared/lib/paths";
import { isMainWindow } from "@/shared/lib/windowRole";
import { openDocumentAt } from "@/shared/session/documentClaims";
import { isPdfPath, launchRequest } from "@/shared/rpc/files";
import { useDropTargetStore } from "@/shared/store/dropTargetStore";
import { useLaunchStore } from "@/shared/store/launchStore";
import type { LaunchRequest } from "@/types";
import { isOpenablePath } from "./convertedDocuments";
import { routeForLaunch } from "./launchRoute";
import { useDocumentWindow } from "./useDocumentWindow";
import { useOpenPdf } from "./useOpenPdf";

const MULTI_FILE_TOOLS = new Set(["merge", "batch", "rename"]);
const LAUNCH_BATCH_MS = 900;

export function FileOpenListener() {
  const { openPaths, pickAndOpen } = useOpenPdf();
  const navigate = useNavigate();
  const openWindow = useDocumentWindow();
  const openWindowRef = useRef(openWindow);
  openWindowRef.current = openWindow;
  const openPathsRef = useRef(openPaths);
  const pickRef = useRef(pickAndOpen);
  const navigateRef = useRef(navigate);
  openPathsRef.current = openPaths;
  pickRef.current = pickAndOpen;
  navigateRef.current = navigate;
  const startedRef = useRef(false);

  useEffect(() => {
    let batchTool: string | null = null;
    let batchPaths: string[] = [];
    let batchTimer: number | null = null;
    const flushBatch = () => {
      if (!batchTool) return;
      const route = routeForLaunch(batchTool, batchPaths[0]);
      const paths = [...batchPaths];
      batchTool = null;
      batchPaths = [];
      batchTimer = null;
      if (!route) return;
      useLaunchStore.getState().setPending(paths[0] ?? null, route);
      useLaunchStore.getState().setPendingPaths(paths);
      void navigateRef.current(route);
    };
    const applyLaunch = (request: LaunchRequest) => {
      const route = request.tool ? routeForLaunch(request.tool, request.paths[0]) : null;
      if (!route) {
        const openable = request.paths.filter(isOpenablePath);
        if (openable.length > 0) void openPathsRef.current(openable);
        return;
      }
      if (request.tool && MULTI_FILE_TOOLS.has(request.tool)) {
        if (batchTool !== request.tool) {
          batchTool = request.tool;
          batchPaths = [];
        }
        batchPaths.push(...request.paths.filter((path) => !batchPaths.includes(path)));
        if (batchTimer !== null) window.clearTimeout(batchTimer);
        batchTimer = window.setTimeout(flushBatch, LAUNCH_BATCH_MS);
        return;
      }
      useLaunchStore.getState().setPending(request.paths[0] ?? null, route);
      useLaunchStore.getState().setPendingPaths(request.paths);
      void navigateRef.current(route);
    };
    if (!startedRef.current) {
      startedRef.current = true;
      void launchRequest().then(applyLaunch);
    }
    if (!isMainWindow()) return;
    const unlisten = listen<LaunchRequest>("launch", (event) => applyLaunch(event.payload));
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    const label = getCurrentWindow().label;
    const unlisten = listen<{ label: string; path: string }>("focus-document", (event) => {
      if (event.payload.label !== label) return;
      void openPathsRef.current([openDocumentAt(event.payload.path)?.path ?? event.payload.path]);
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    const unlistenDrop = getCurrentWebview().onDragDropEvent((event) => {
      const dropStore = useDropTargetStore.getState();
      if (event.payload.type === "enter" || event.payload.type === "over") {
        if (!dropStore.dragging) dropStore.setDragging(true);
        return;
      }
      dropStore.setDragging(false);
      if (event.payload.type !== "drop") return;
      if (useDropTargetStore.getState().claimPositionDrop(event.payload.paths, event.payload.position)) return;
      const handler = useDropTargetStore.getState().handler;
      if (handler) {
        handler(event.payload.paths);
        return;
      }
      const openable = event.payload.paths.filter(isOpenablePath);
      if (openable.length > 0) {
        void openPathsRef.current(openable);
        return;
      }
      const convertible = event.payload.paths.find((path) => !isPdfPath(path) && extensionOf(path) !== "");
      if (!convertible) return;
      const target = routeForLaunch("topdf", convertible) ?? "/tools/convert?mode=file-to-pdf";
      useLaunchStore.getState().setPending(convertible, target);
      void navigateRef.current(target);
    });
    return () => {
      void unlistenDrop.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        void pickRef.current();
      } else if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void openWindowRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return null;
}
