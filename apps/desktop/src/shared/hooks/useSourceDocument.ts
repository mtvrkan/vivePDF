import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toRpcError } from "@/shared/rpc/client";
import { getDocumentInfo } from "@/shared/rpc/documents";
import { fileNameOf, isPdfPath } from "@/shared/rpc/files";
import { useDropTargetStore } from "@/shared/store/dropTargetStore";
import { useLaunchStore } from "@/shared/store/launchStore";
import { useActiveOpenDocument } from "@/shared/store/documentStore";
import { useSourceChangeStore } from "@/shared/store/sourceChangeStore";
import type { AsyncStatus, RpcError, SourceDocument } from "@/types";

export function shouldPrefillSource(chosen: boolean, source: SourceDocument | null, active: unknown): active is NonNullable<typeof active> {
  return !chosen && !source && !!active;
}

export function useSourceDocument() {
  const active = useActiveOpenDocument();
  const [source, setSource] = useState<SourceDocument | null>(null);
  const [status, setStatus] = useState<AsyncStatus>("idle");
  const [error, setError] = useState<RpcError | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const chosen = useRef(false);

  useEffect(() => {
    if (!shouldPrefillSource(chosen.current, source, active)) return;
    setSource({ path: active.path, fileName: active.fileName, password: active.password, info: active.info });
    setStatus(active.info ? "success" : "idle");
  }, [active, source]);

  const sourcePath = source?.path ?? null;
  useEffect(() => {
    if (sourcePath) useSourceChangeStore.getState().changed();
  }, [sourcePath]);

  const load = useCallback(async (path: string, password: string | null) => {
    chosen.current = true;
    setSource({ path, fileName: fileNameOf(path), password, info: null });
    setStatus("loading");
    setError(null);
    setNeedsPassword(false);
    try {
      const info = await getDocumentInfo({ path, password: password ?? undefined });
      setSource({ path, fileName: fileNameOf(path), password, info });
      setStatus("success");
    } catch (caught) {
      const rpcError = toRpcError(caught);
      setError(rpcError);
      setStatus("error");
      setNeedsPassword(rpcError.code === "NEEDS_PASSWORD");
    }
  }, []);

  const pendingPath = useLaunchStore((state) => state.pendingPath);
  const { pathname } = useLocation();

  useEffect(() => {
    if (!pendingPath) return;
    const pending = useLaunchStore.getState().consumeIf(isPdfPath, pathname);
    if (pending) void load(pending, null);
  }, [pendingPath, pathname, load]);

  useEffect(() => {
    const store = useDropTargetStore.getState();
    if (store.handler) return;
    store.setHandler((paths) => {
      const pdf = paths.find(isPdfPath);
      if (pdf) void load(pdf, null);
    });
    return () => useDropTargetStore.getState().setHandler(null);
  }, [load]);

  const pick = useCallback(async () => {
    const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (typeof selected === "string") await load(selected, null);
  }, [load]);

  const setPath = useCallback((path: string) => load(path, null), [load]);

  const submitPassword = useCallback(
    async (password: string) => {
      if (source) await load(source.path, password);
    },
    [load, source],
  );

  return { source, status, error, needsPassword, pick, setPath, submitPassword };
}
