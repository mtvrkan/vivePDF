import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useDocumentManagerCapability } from "@embedpdf/plugin-document-manager/react";
import { documentRoomError } from "@/shared/lib/documentLimit";
import { RpcCallError, toRpcError } from "@/shared/rpc/client";
import { getDocumentInfo } from "@/shared/rpc/documents";
import { fileNameOf, readDocumentBytes, releaseViewSource } from "@/shared/rpc/files";
import { closeViewable, openViewable, readOriginalSource } from "@/shared/session/viewSources";
import { useToastStore } from "@/shared/store/toastStore";
import type { OrganizerSource, OrganizerTile, PageRotation } from "@/types";
import { tileKey, useOrganizerStore } from "./organizerStore";
import { describeError } from "@/shared/lib/errorMessage";
import { isPdfPasswordError } from "@/shared/lib/pdfPassword";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff", "heic", "heif"]);

export function isImagePath(path: string): boolean {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(extension);
}

export type PdfSourceLoad =
  | { status: "ready"; source: OrganizerSource }
  | { status: "password"; wrongPassword: boolean }
  | { status: "error" };

export type SourceReattach = { status: "ready" } | { status: "stale" } | { status: "password"; wrongPassword: boolean } | { status: "error" };

export function useInsertSources() {
  const { t } = useTranslation();
  const { provides: docManager } = useDocumentManagerCapability();
  const addSource = useOrganizerStore((state) => state.addSource);
  const attachSource = useOrganizerStore((state) => state.attachSource);
  const toast = useToastStore((state) => state.push);

  const openEmbedded = useCallback(
    async (path: string, password: string | null): Promise<{ pageCount: number; embedDocId: string | null } | null> => {
      const organizerDocumentId = useOrganizerStore.getState().documentId;
      const info = await getDocumentInfo({ path, password: password ?? undefined });
      const embedDocId = `src-${crypto.randomUUID()}`;
      if (docManager) {
        const noRoom = documentRoomError(docManager.getDocumentCount());
        if (noRoom) throw new RpcCallError(noRoom);
        const source = await readOriginalSource(path);
        if (useOrganizerStore.getState().documentId !== organizerDocumentId) {
          if (source.kind === "range") void releaseViewSource(source.token);
          return null;
        }
        try {
          await openViewable(docManager, source, { name: fileNameOf(path), documentId: embedDocId, password: password ?? undefined, autoActivate: false });
        } catch (error) {
          closeViewable(docManager, embedDocId);
          throw error;
        }
      }
      if (useOrganizerStore.getState().documentId !== organizerDocumentId) {
        if (docManager) closeViewable(docManager, embedDocId);
        return null;
      }
      return { pageCount: info.pageCount, embedDocId: docManager ? embedDocId : null };
    },
    [docManager],
  );

  const failedLoad = useCallback(
    (error: unknown, password: string | null): { status: "password"; wrongPassword: boolean } | { status: "error" } => {
      const rpcError = toRpcError(error);
      if (rpcError.code === "NEEDS_PASSWORD" || isPdfPasswordError(error)) {
        return { status: "password", wrongPassword: password !== null };
      }
      toast("error", describeError(t, rpcError));
      return { status: "error" };
    },
    [toast, t],
  );

  const changedSource = useCallback(
    (source: OrganizerSource, embedDocId: string | null): { status: "error" } => {
      if (docManager && embedDocId) closeViewable(docManager, embedDocId);
      toast("error", t("tools.pages.sourceChanged", { name: source.fileName }));
      return { status: "error" };
    },
    [docManager, toast, t],
  );

  const loadPdfSource = useCallback(
    async (path: string, password: string | null): Promise<PdfSourceLoad> => {
      const existing = Object.values(useOrganizerStore.getState().sources).find((source) => source.path === path);
      if (existing && (existing.embedDocId || !docManager)) return { status: "ready", source: existing };
      try {
        const embedded = await openEmbedded(path, password);
        if (!embedded) return { status: "error" };
        if (existing) {
          if (embedded.pageCount !== existing.pageCount) return changedSource(existing, embedded.embedDocId);
          attachSource(existing.id, { embedDocId: embedded.embedDocId, password });
          return { status: "ready", source: { ...existing, embedDocId: embedded.embedDocId, password } };
        }
        const source: OrganizerSource = {
          id: `s-${crypto.randomUUID().slice(0, 8)}`,
          path,
          password,
          fileName: fileNameOf(path),
          embedDocId: embedded.embedDocId,
          pageCount: embedded.pageCount,
        };
        addSource(source);
        return { status: "ready", source };
      } catch (error) {
        return failedLoad(error, password);
      }
    },
    [openEmbedded, failedLoad, addSource, attachSource, changedSource, docManager],
  );

  const reattachSource = useCallback(
    async (source: OrganizerSource, password: string | null): Promise<SourceReattach> => {
      try {
        const embedded = await openEmbedded(source.path, password);
        if (!embedded) return { status: "stale" };
        if (embedded.pageCount !== source.pageCount) return changedSource(source, embedded.embedDocId);
        attachSource(source.id, { embedDocId: embedded.embedDocId, password });
        return { status: "ready" };
      } catch (error) {
        return failedLoad(error, password);
      }
    },
    [openEmbedded, failedLoad, attachSource, changedSource],
  );

  const imageTiles = useCallback(async (paths: string[]): Promise<OrganizerTile[]> => {
    const tiles: OrganizerTile[] = [];
    for (const path of paths) {
      let previewUrl = "";
      try {
        const bytes = await readDocumentBytes(path);
        previewUrl = URL.createObjectURL(new Blob([bytes]));
      } catch {
        previewUrl = "";
      }
      tiles.push({ key: tileKey(), kind: "image", path, fileName: fileNameOf(path), previewUrl, rotate: 0 });
    }
    return tiles;
  }, []);

  const pageTiles = useCallback((source: OrganizerSource, indices: number[], rotate: PageRotation = 0): OrganizerTile[] => {
    return indices.map((index) => ({ key: tileKey(), kind: "page", sourceId: source.id, index, rotate }));
  }, []);

  return { loadPdfSource, reattachSource, imageTiles, pageTiles };
}

export function parseRanges(spec: string, pageCount: number): number[] | null {
  const text = spec.trim();
  if (!text) return Array.from({ length: pageCount }, (_, index) => index + 1);
  const pages: number[] = [];
  for (const token of text.split(",")) {
    const match = /^\s*(\d*)\s*(-)?\s*(\d*)\s*$/.exec(token);
    if (!match || !token.trim()) return null;
    const [, first, dash, last] = match;
    if (!first && !last) return null;
    const start = first ? Number(first) : 1;
    const end = last ? Number(last) : dash ? pageCount : start;
    if (start < 1 || end < 1 || start > pageCount || end > pageCount) return null;
    const step = end >= start ? 1 : -1;
    for (let page = start; step > 0 ? page <= end : page >= end; page += step) pages.push(page);
  }
  return pages;
}
