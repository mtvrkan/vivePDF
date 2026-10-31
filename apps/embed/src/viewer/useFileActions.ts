import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useRegistry } from "@embedpdf/core/preact";
import { Rotation } from "@embedpdf/models";
import { useRenderCapability } from "@embedpdf/plugin-render/preact";
import { clickDownload, downloadableUrl, downloadThroughBlob, savesDirectly } from "./download";
import { openExternal } from "./links";
import { PRINT_SCALE, sheetSize } from "./printLayout";
import { printPages, type PrintJob, type PrintPage } from "./printPages";

export type FileTask = { kind: "print"; done: number; total: number } | { kind: "download" } | null;

export type FileActions = { task: FileTask; print: () => void; download: (() => void) | null; cancel: () => void };

const PRINT_OPTIONS = { scaleFactor: PRINT_SCALE, dpr: 1, rotation: Rotation.Degree0, imageType: "image/png", withAnnotations: true, withForms: true } as const;

export function useFileActions(documentId: string, sourceUrl: string, fileName: string): FileActions {
  const { documents } = useRegistry();
  const { provides: render } = useRenderCapability();
  const pdfDocument = documents[documentId]?.document ?? null;
  const [task, setTask] = useState<FileTask>(null);
  const runRef = useRef(0);
  const busyRef = useRef(false);
  const jobRef = useRef<PrintJob | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const href = downloadableUrl(sourceUrl, document.baseURI);

  const finish = useCallback(() => {
    busyRef.current = false;
    setTask(null);
  }, []);

  const cancel = useCallback(() => {
    runRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    finish();
  }, [finish]);

  useEffect(
    () => () => {
      runRef.current += 1;
      abortRef.current?.abort();
      jobRef.current?.dispose();
    },
    [],
  );

  const print = useCallback(async () => {
    if (busyRef.current || !render || !pdfDocument) return;
    busyRef.current = true;
    const run = ++runRef.current;
    const wanted = () => runRef.current === run;
    jobRef.current?.dispose();
    jobRef.current = null;
    const scope = render.forDocument(documentId);
    const total = pdfDocument.pages.length;
    const pages: PrintPage[] = [];
    setTask({ kind: "print", done: 0, total });
    for (const page of pdfDocument.pages) {
      const url = await scope
        .renderPage({ pageIndex: page.index, options: PRINT_OPTIONS })
        .toPromise()
        .then(
          (blob) => URL.createObjectURL(blob),
          () => null,
        );
      pages.push({ url, size: page.size });
      if (!wanted()) break;
      setTask({ kind: "print", done: pages.length, total });
    }
    if (!wanted()) {
      for (const page of pages) if (page.url) URL.revokeObjectURL(page.url);
      return;
    }
    jobRef.current = await printPages(pages, sheetSize(pdfDocument.pages[0]?.size), wanted);
    if (wanted()) finish();
  }, [render, pdfDocument, documentId, finish]);

  const download = useCallback(async () => {
    if (busyRef.current || !href) return;
    if (savesDirectly(href, location.origin)) {
      clickDownload(href, fileName);
      return;
    }
    busyRef.current = true;
    const run = ++runRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setTask({ kind: "download" });
    try {
      await downloadThroughBlob(href, fileName, controller.signal);
    } catch {
      if (!controller.signal.aborted) openExternal(href);
    }
    if (runRef.current === run) {
      abortRef.current = null;
      finish();
    }
  }, [href, fileName, finish]);

  const startPrint = useCallback(() => void print(), [print]);
  const startDownload = useMemo(() => (href ? () => void download() : null), [href, download]);
  return { task, print: startPrint, download: startDownload, cancel };
}
