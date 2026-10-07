import { useEffect, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { join, tempDir } from "@tauri-apps/api/path";
import { useAnnotation } from "@embedpdf/plugin-annotation/react";
import { useExport } from "@embedpdf/plugin-export/react";
import { usePrint } from "@embedpdf/plugin-print/react";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { Select } from "@/components/shared/Select";
import { Checkbox, Field, TextInput } from "@/components/tool/form";
import { describeError } from "@/shared/lib/errorMessage";
import * as logger from "@/shared/lib/logger";
import { toRpcError } from "@/shared/rpc/client";
import { deleteFile, writeDocumentBytes } from "@/shared/rpc/files";
import { listPrinters, runPrint } from "@/shared/rpc/operations";
import { useDocumentStore } from "@/shared/store/documentStore";
import { usePrintDialogStore } from "@/shared/store/printDialogStore";
import { useToastStore } from "@/shared/store/toastStore";
import type { PagesPerSheet, PrinterInfo, PrintSubset, RpcProgress } from "@/types";
import { useUnsavedMarks } from "./useUnsavedMarks";

type PagesMode = "all" | "current" | "range";
type ScaleMode = "fit" | "actual";

const PAGES_PER_SHEET: PagesPerSheet[] = [1, 2, 4, 6, 9];

export function PrintDialog({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const toast = useToastStore((state) => state.push);
  const open = usePrintDialogStore((state) => state.open);
  const setOpen = usePrintDialogStore((state) => state.setOpen);
  const presetPages = usePrintDialogStore((state) => state.presetPages);
  const file = usePrintDialogStore((state) => state.file);
  const { provides: exporter } = useExport(documentId);
  const { provides: annotation } = useAnnotation(documentId);
  const hasUnsavedMarks = useUnsavedMarks(documentId);
  const document = useDocumentStore((state) => state.documents[documentId] ?? null);
  const { state: scrollState } = useScroll(documentId);
  const { provides: preview } = usePrint(documentId);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [printer, setPrinter] = useState("");
  const [pagesMode, setPagesMode] = useState<PagesMode>("all");
  const [range, setRange] = useState("");
  const [copies, setCopies] = useState("1");
  const [scale, setScale] = useState<ScaleMode>("fit");
  const [grayscale, setGrayscale] = useState(false);
  const [subset, setSubset] = useState<PrintSubset>("all");
  const [reverse, setReverse] = useState(false);
  const [annotations, setAnnotations] = useState(true);
  const [autoRotate, setAutoRotate] = useState(true);
  const [pagesPerSheet, setPagesPerSheet] = useState<PagesPerSheet>(1);
  const [progress, setProgress] = useState<RpcProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoadingPrinters(true);
    void listPrinters()
      .then((result) => {
        setPrinters(result.printers);
        setPrinter((current) => (current && result.printers.some((entry) => entry.name === current) ? current : (result.default ?? result.printers[0]?.name ?? "")));
      })
      .catch((caught) => toast("error", describeError(t, toRpcError(caught))))
      .finally(() => setLoadingPrinters(false));
  }, [open, toast, t]);

  useEffect(() => {
    if (!open || !presetPages) return;
    setPagesMode("range");
    setRange(presetPages);
  }, [open, presetPages]);

  useEffect(() => {
    if (open && file) setPagesMode((mode) => (mode === "current" ? "all" : mode));
  }, [open, file]);

  if (!open || !document) return null;

  const totalPages = file ? file.pageCount : scrollState.totalPages;

  const copiesValue = Math.min(99, Math.max(1, Number.parseInt(copies, 10) || 1));
  const pagesSpec = pagesMode === "all" ? undefined : pagesMode === "current" ? String(scrollState.currentPage) : range.trim();
  const canPrint = !busy && !loadingPrinters && printers.length > 0 && (pagesMode !== "range" || pagesSpec !== "");

  const finish = () => {
    if (file?.temporary) void deleteFile(file.path).catch((caught: unknown) => logger.warn("viewer.print", `could not delete ${file.path}: ${String(caught)}`));
    setOpen(false);
  };

  const close = () => {
    if (busy) return;
    finish();
  };

  const print = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setProgress(null);
    let snapshot: string | null = null;
    try {
      if (!file && hasUnsavedMarks && exporter) {
        await annotation?.commit().toPromise();
        const bytes = await exporter.saveAsCopy().toPromise();
        snapshot = await join(await tempDir(), `vivepdf-print-${crypto.randomUUID()}.pdf`);
        await writeDocumentBytes(snapshot, bytes);
      }
      const result = await runPrint(
        { path: snapshot ?? file?.path ?? document.path, password: (file ? file.password : document.password) ?? undefined, printer: printer || undefined, pages: pagesSpec, copies: copiesValue, scale, grayscale, subset, reverse, annotations, autoRotate, pagesPerSheet },
        { onProgress: setProgress, signal: controller.signal },
      );
      toast("success", t("viewer.printDialog.done", { pages: result.pages, printer: result.printer }));
      finish();
    } catch (caught) {
      const error = toRpcError(caught);
      if (error.code !== "CANCELLED") toast("error", describeError(t, error));
    } finally {
      if (snapshot) void deleteFile(snapshot).catch(() => undefined);
      abortRef.current = null;
      setBusy(false);
      setProgress(null);
    }
  };

  const systemPreview = () => {
    setOpen(false);
    preview?.print();
  };

  const percent = Math.round((progress?.progress ?? 0) * 100);

  return (
    <Dialog
      open
      title={t("viewer.printDialog.title")}
      onClose={close}
      footer={
        <div className="flex items-center gap-2">
          {file ? null : (
            <Button type="button" variant="ghost" onClick={systemPreview} disabled={busy}>
              {t("viewer.printDialog.preview")}
            </Button>
          )}
          <span className="flex-1" />
          {busy ? (
            <Button type="button" variant="secondary" onClick={() => abortRef.current?.abort()}>
              {t("common.cancel")}
            </Button>
          ) : (
            <Button type="button" variant="ghost" onClick={close}>
              {t("common.close")}
            </Button>
          )}
          <Button type="button" variant="primary" icon={<Printer className="size-4" aria-hidden />} onClick={() => void print()} disabled={!canPrint} loading={busy}>
            {t("viewer.printDialog.print")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label={t("viewer.printDialog.printer")}>
          {printers.length === 0 && !loadingPrinters ? (
            <p className="text-sm text-warning">{t("viewer.printDialog.noPrinters")}</p>
          ) : (
            <Select value={printer} options={printers.map((entry) => ({ value: entry.name, label: entry.isDefault ? `${entry.name} · ${t("viewer.printDialog.default")}` : entry.name }))} onChange={setPrinter} disabled={busy || loadingPrinters} placeholder={loadingPrinters ? t("common.loading") : undefined} ariaLabel={t("viewer.printDialog.printer")} />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("viewer.printDialog.pages")}>
            <Select
              value={pagesMode}
              options={[
                { value: "all", label: t("viewer.printDialog.pagesAll", { count: totalPages }) },
                ...(file ? [] : [{ value: "current", label: t("viewer.printDialog.pagesCurrent", { page: scrollState.currentPage }) }]),
                { value: "range", label: t("viewer.printDialog.pagesRange") },
              ]}
              onChange={(value) => setPagesMode(value as PagesMode)}
              disabled={busy}
              ariaLabel={t("viewer.printDialog.pages")}
            />
          </Field>
          <Field label={t("viewer.printDialog.copies")}>
            <TextInput value={copies} onChange={(event) => setCopies(event.target.value)} inputMode="numeric" disabled={busy} aria-label={t("viewer.printDialog.copies")} />
          </Field>
        </div>
        {pagesMode === "range" ? (
          <TextInput autoFocus value={range} onChange={(event) => setRange(event.target.value)} placeholder={t("viewer.printDialog.rangePlaceholder")} disabled={busy} className="font-mono" aria-label={t("viewer.printDialog.pagesRange")} />
        ) : null}
        <div className="grid grid-cols-2 items-end gap-3">
          <Field label={t("viewer.printDialog.scale")}>
            <Select
              value={scale}
              options={[
                { value: "fit", label: t("viewer.printDialog.scaleFit") },
                { value: "actual", label: t("viewer.printDialog.scaleActual") },
              ]}
              onChange={(value) => setScale(value as ScaleMode)}
              disabled={busy || pagesPerSheet > 1}
              ariaLabel={t("viewer.printDialog.scale")}
            />
          </Field>
          <Checkbox label={t("viewer.printDialog.grayscale")} checked={grayscale} onChange={setGrayscale} disabled={busy} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("viewer.printDialog.subset")}>
            <Select
              value={subset}
              options={[
                { value: "all", label: t("viewer.printDialog.subsetAll") },
                { value: "odd", label: t("viewer.printDialog.subsetOdd") },
                { value: "even", label: t("viewer.printDialog.subsetEven") },
              ]}
              onChange={(value) => setSubset(value as PrintSubset)}
              disabled={busy}
              ariaLabel={t("viewer.printDialog.subset")}
            />
          </Field>
          <Field label={t("viewer.printDialog.pagesPerSheet")}>
            <Select
              value={String(pagesPerSheet)}
              options={PAGES_PER_SHEET.map((value) => ({ value: String(value), label: String(value) }))}
              onChange={(value) => setPagesPerSheet(Number(value) as PagesPerSheet)}
              disabled={busy}
              ariaLabel={t("viewer.printDialog.pagesPerSheet")}
            />
          </Field>
        </div>
        <Field label={t("viewer.printDialog.annotations")}>
          <Select
            value={annotations ? "include" : "exclude"}
            options={[
              { value: "include", label: t("viewer.printDialog.annotationsInclude") },
              { value: "exclude", label: t("viewer.printDialog.annotationsExclude") },
            ]}
            onChange={(value) => setAnnotations(value === "include")}
            disabled={busy}
            ariaLabel={t("viewer.printDialog.annotations")}
          />
        </Field>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Checkbox label={t("viewer.printDialog.reverse")} checked={reverse} onChange={setReverse} disabled={busy} />
          <Checkbox label={t("viewer.printDialog.autoRotate")} checked={autoRotate} onChange={setAutoRotate} disabled={busy} />
        </div>
        {busy ? (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">{progress?.message ? t(progress.message, { defaultValue: t("tools.working"), ...progress.detail }) : t("viewer.printDialog.preparing")}</p>
            <div className="h-1 w-full overflow-hidden rounded-sm bg-muted" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-primary transition-[width] duration-(--transition-fast)" style={{ width: `${percent}%` }} />
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("viewer.printDialog.hint")}</p>
        )}
      </div>
    </Dialog>
  );
}
