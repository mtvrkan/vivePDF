import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Printer, RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { join, tempDir } from "@tauri-apps/api/path";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { Select } from "@/components/shared/Select";
import { Checkbox, Field, TextInput } from "@/components/tool/form";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { deleteFile } from "@/shared/rpc/files";
import { listPrinters, runPrint } from "@/shared/rpc/operations";
import { useToastStore } from "@/shared/store/toastStore";
import type { PrinterInfo, RpcError, RpcProgress } from "@/types";
import { useMergeStore } from "../merge/mergeStore";
import { exportDesign } from "./exportDesign";
import { selectPages, type PageChoice } from "./exportPages";
import { PageRangePicker } from "./PageRangePicker";
import { useStudioStore } from "./studioStore";

type ScaleMode = "fit" | "actual";
type PrinterState = { status: "loading" } | { status: "ready"; printers: PrinterInfo[] } | { status: "error"; error: RpcError };

const MAX_COPIES = 99;
const PRINT_DPI = 150;

export function StudioPrintDialog({ open, onClose, language }: { open: boolean; onClose: () => void; language: string }) {
  const { t } = useTranslation();
  const toast = useToastStore((state) => state.push);
  const name = useStudioStore((state) => state.design?.name ?? "");
  const designPages = useStudioStore((state) => state.design?.pages);
  const pageId = useStudioStore((state) => state.pageId);
  const dataPath = useMergeStore((state) => state.dataPath);
  const sheet = useMergeStore((state) => state.sheet);
  const table = useMergeStore((state) => state.table);
  const [printers, setPrinters] = useState<PrinterState>({ status: "loading" });
  const [printer, setPrinter] = useState("");
  const [copies, setCopies] = useState("1");
  const [scale, setScale] = useState<ScaleMode>("fit");
  const [grayscale, setGrayscale] = useState(false);
  const [useData, setUseData] = useState(false);
  const [pageChoice, setPageChoice] = useState<PageChoice>("all");
  const [customPages, setCustomPages] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<RpcProgress | null>(null);
  const [failure, setFailure] = useState<RpcError | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadPrinters = useCallback(() => {
    setPrinters({ status: "loading" });
    listPrinters()
      .then((result) => {
        setPrinters({ status: "ready", printers: result.printers });
        setPrinter((current) => (current && result.printers.some((entry) => entry.name === current) ? current : (result.default ?? result.printers[0]?.name ?? "")));
      })
      .catch((caught) => setPrinters({ status: "error", error: toRpcError(caught) }));
  }, []);

  useEffect(() => {
    if (open) loadPrinters();
  }, [open, loadPrinters]);

  const pageCount = designPages?.length ?? 0;
  const currentIndex = Math.max(0, designPages?.findIndex((page) => page.id === pageId) ?? 0);
  const selection = useMemo(() => selectPages(pageChoice, customPages, currentIndex, pageCount), [pageChoice, customPages, currentIndex, pageCount]);
  const rows = dataPath && table && table.totalRows > 0 ? table.totalRows : 0;
  const copiesValue = Math.min(MAX_COPIES, Math.max(1, Number.parseInt(copies, 10) || 1));
  const available = printers.status === "ready" && printers.printers.length > 0;
  const canPrint = !busy && available && Boolean(printer) && selection.ok;

  const close = () => {
    if (!busy) onClose();
  };

  const print = async () => {
    if (!selection.ok) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setFailure(null);
    setProgress(null);
    let snapshot: string | null = null;
    try {
      const target = await join(await tempDir(), `vivepdf-studio-print-${crypto.randomUUID()}.pdf`);
      const rendered = await exportDesign(
        { output: target, overwrite: true, format: "pdf", dpi: PRINT_DPI, pages: selection.pages, language, title: name, embed: false, dataPath: useData && rows ? dataPath : null, sheet: useData && rows ? sheet : null },
        { onProgress: setProgress, signal: controller.signal },
      );
      snapshot = rendered.output;
      const result = await runPrint({ path: rendered.output, printer, copies: copiesValue, scale, grayscale }, { onProgress: setProgress, signal: controller.signal });
      toast("success", t("viewer.printDialog.done", { pages: result.pages, printer: result.printer }));
      onClose();
    } catch (caught) {
      const error = toRpcError(caught);
      if (error.code !== "CANCELLED") setFailure(error);
    } finally {
      if (snapshot) void deleteFile(snapshot).catch(() => undefined);
      abortRef.current = null;
      setBusy(false);
      setProgress(null);
    }
  };

  if (!open) return null;
  const percent = Math.round((progress?.progress ?? 0) * 100);

  return (
    <Dialog
      open
      title={t("viewer.printDialog.title")}
      onClose={close}
      footer={
        <>
          {busy ? (
            <Button type="button" variant="secondary" onClick={() => abortRef.current?.abort()}>
              {t("common.cancel")}
            </Button>
          ) : (
            <Button type="button" variant="ghost" onClick={close}>
              {t("common.close")}
            </Button>
          )}
          <Button type="button" variant="primary" icon={<Printer className="size-4" aria-hidden />} onClick={() => void print()} disabled={!canPrint} loading={busy} data-testid="studio-print-run">
            {t("viewer.printDialog.print")}
          </Button>
        </>
      }
    >
      <div className="space-y-4" aria-busy={busy || printers.status === "loading"}>
        {printers.status === "ready" && printers.printers.length > 0 ? (
          <Field label={t("viewer.printDialog.printer")}>
            <Select
              value={printer}
              options={printers.printers.map((entry) => ({ value: entry.name, label: entry.isDefault ? `${entry.name} · ${t("viewer.printDialog.default")}` : entry.name }))}
              onChange={setPrinter}
              disabled={busy}
              ariaLabel={t("viewer.printDialog.printer")}
            />
          </Field>
        ) : (
          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-foreground/80">{t("viewer.printDialog.printer")}</span>
            {printers.status === "loading" ? (
              <div className="h-row w-full animate-pulse rounded-lg bg-muted" aria-hidden data-testid="studio-print-loading" />
            ) : (
              <div className="flex flex-wrap items-center gap-2" role={printers.status === "error" ? "alert" : undefined}>
                <p className={printers.status === "error" ? "min-w-0 flex-1 text-sm text-destructive" : "min-w-0 flex-1 text-sm text-warning"}>
                  {printers.status === "error" ? describeError(t, printers.error) : t("viewer.printDialog.noPrinters")}
                </p>
                <Button type="button" size="sm" icon={<RotateCw className="size-4" aria-hidden />} onClick={loadPrinters}>
                  {t("common.retry")}
                </Button>
              </div>
            )}
          </div>
        )}
        {pageCount > 1 ? <PageRangePicker choice={pageChoice} custom={customPages} onChoice={setPageChoice} onCustom={setCustomPages} pageCount={pageCount} currentIndex={currentIndex} selection={selection} disabled={busy} /> : null}
        <div className="grid grid-cols-2 items-end gap-3">
          <Field label={t("viewer.printDialog.copies")}>
            <TextInput value={copies} onChange={(event) => setCopies(event.target.value)} inputMode="numeric" disabled={busy} />
          </Field>
          <Field label={t("viewer.printDialog.scale")}>
            <Select
              value={scale}
              options={[
                { value: "fit", label: t("viewer.printDialog.scaleFit") },
                { value: "actual", label: t("viewer.printDialog.scaleActual") },
              ]}
              onChange={(value) => setScale(value as ScaleMode)}
              disabled={busy}
              ariaLabel={t("viewer.printDialog.scale")}
            />
          </Field>
        </div>
        <Checkbox label={t("viewer.printDialog.grayscale")} checked={grayscale} onChange={setGrayscale} disabled={busy} />
        {rows ? <Checkbox label={t("studio.export.useData", { count: rows })} hint={t("studio.print.dataHint")} checked={useData} onChange={setUseData} disabled={busy} /> : null}
        {failure ? (
          <p className="text-sm text-destructive" role="alert" data-testid="studio-print-error">
            {describeError(t, failure)}
          </p>
        ) : null}
        {busy ? (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">{progress?.message ? t(progress.message, { defaultValue: t("tools.working"), ...progress.detail }) : t("viewer.printDialog.preparing")}</p>
            <div className="h-1 w-full overflow-hidden rounded-sm bg-muted" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={t("viewer.printDialog.preparing")}>
              <div className="h-full bg-primary transition-[width] duration-(--transition-fast)" style={{ width: `${percent}%` }} />
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("studio.print.hint")}</p>
        )}
      </div>
    </Dialog>
  );
}
