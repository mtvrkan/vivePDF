import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { Dialog } from "@/components/shared/Dialog";
import { Checkbox, Field, SelectInput, SliderField, TextInput } from "@/components/tool/form";
import { basenameOf } from "@/shared/lib/paths";
import type { OrganizerSource, PageSize, PaperPattern, PaperPreset, PaperStyle } from "@/types";
import { PaperPreview } from "./PaperPreview";
import { DEFAULT_PAPER_COLOR, DEFAULT_SPACING, PAPER_SPACING, PAPER_STYLES } from "./paperPattern";
import { parseRanges, useInsertSources, type PdfSourceLoad } from "./useInsertSources";

const PAPER_POINTS: Record<Exclude<PaperPreset, "match">, [number, number]> = {
  a4: [595, 842],
  letter: [612, 792],
  a5: [420, 595],
  a3: [842, 1191],
};

type BlankDialogProps = {
  open: boolean;
  onClose: () => void;
  onInsert: (width: number, height: number, count: number, paper?: PaperPattern) => void;
  matchSize: PageSize | null;
};

type PaperChoice = PaperStyle | "plain";

export function InsertBlankDialog({ open, onClose, onInsert, matchSize }: BlankDialogProps) {
  const { t } = useTranslation();
  const [preset, setPreset] = useState<PaperPreset>(matchSize ? "match" : "a4");
  const [landscape, setLandscape] = useState(false);
  const [count, setCount] = useState(1);
  const [paperStyle, setPaperStyle] = useState<PaperChoice>("plain");
  const [spacing, setSpacing] = useState(DEFAULT_SPACING.lined);
  const [paperColor, setPaperColor] = useState(DEFAULT_PAPER_COLOR);
  const [margin, setMargin] = useState(true);

  let [width, height] = preset === "match" && matchSize ? [matchSize.width, matchSize.height] : PAPER_POINTS[preset === "match" ? "a4" : preset];
  if (landscape !== width > height) [width, height] = [height, width];
  const paper: PaperPattern | undefined = paperStyle === "plain" ? undefined : { style: paperStyle, spacing, color: paperColor, margin: paperStyle === "lined" && margin };

  const choosePaper = (choice: PaperChoice) => {
    setPaperStyle(choice);
    if (choice !== "plain") setSpacing(DEFAULT_SPACING[choice]);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onInsert(width, height, Math.max(1, Math.min(100, count)), paper);
  };

  return (
    <Dialog open={open} title={t("tools.pages.insertBlank")} onClose={onClose} size={paper ? "lg" : "md"}>
      <form onSubmit={submit} className="flex flex-wrap gap-4">
        <div className="min-w-0 flex-1 space-y-3">
          <Field label={t("tools.pages.paperSize")}>
            <SelectInput value={preset} onChange={(event) => setPreset(event.target.value as PaperPreset)}>
              {matchSize ? <option value="match">{t("tools.pages.matchPage")}</option> : null}
              <option value="a4">A4</option>
              <option value="a5">A5</option>
              <option value="a3">A3</option>
              <option value="letter">Letter</option>
            </SelectInput>
          </Field>
          <Field label={t("tools.pages.orientation")}>
            <SelectInput value={landscape ? "landscape" : "portrait"} onChange={(event) => setLandscape(event.target.value === "landscape")}>
              <option value="portrait">{t("tools.pages.portrait")}</option>
              <option value="landscape">{t("tools.pages.landscape")}</option>
            </SelectInput>
          </Field>
          <Field label={t("tools.pages.count")}>
            <TextInput type="number" min={1} max={100} value={count} onChange={(event) => setCount(Number(event.target.value))} className="w-24 font-mono" />
          </Field>
          <Field label={t("tools.pages.paper.label")}>
            <SelectInput value={paperStyle} onChange={(event) => choosePaper(event.target.value as PaperChoice)}>
              <option value="plain">{t("tools.pages.paper.plain")}</option>
              {PAPER_STYLES.map((style) => (
                <option key={style} value={style}>{t(`tools.pages.paper.${style}`)}</option>
              ))}
            </SelectInput>
          </Field>
          {paper ? (
            <>
              <SliderField
                label={t("tools.pages.paper.spacing")}
                value={spacing}
                min={PAPER_SPACING.min}
                max={PAPER_SPACING.max}
                step={PAPER_SPACING.step}
                onChange={setSpacing}
                format={(value) => t("tools.pages.paper.millimetres", { value })}
              />
              <Field label={t("tools.pages.paper.color")}>
                <ColorSwatch value={paperColor} onChange={setPaperColor} label={t("tools.pages.paper.color")} customLabel={t("colorPicker.custom")} />
              </Field>
              {paperStyle === "lined" ? <Checkbox label={t("tools.pages.paper.margin")} checked={margin} onChange={setMargin} /> : null}
            </>
          ) : null}
        </div>
        {paper ? (
          <div className="flex w-40 shrink-0 items-start justify-center">
            <PaperPreview width={width} height={height} paper={paper} className="w-full rounded-sm border bg-card" />
          </div>
        ) : null}
        <div className="flex w-full justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary">{t("tools.pages.insert")}</Button>
        </div>
      </form>
    </Dialog>
  );
}

type PdfDialogProps = {
  path: string | null;
  replacing?: boolean;
  onClose: () => void;
  onInsert: (source: OrganizerSource, pages: number[]) => void;
};

export function InsertPdfDialog({ path, replacing = false, onClose, onInsert }: PdfDialogProps) {
  const { t } = useTranslation();
  const { loadPdfSource } = useInsertSources();
  const [load, setLoad] = useState<PdfSourceLoad | { status: "loading" } | null>(null);
  const [password, setPassword] = useState("");
  const [ranges, setRanges] = useState("");

  useEffect(() => {
    if (!path) {
      setLoad(null);
      setPassword("");
      setRanges("");
      return;
    }
    setLoad({ status: "loading" });
    void loadPdfSource(path, null).then(setLoad);
  }, [path, loadPdfSource]);

  const retryWithPassword = (event: FormEvent) => {
    event.preventDefault();
    if (!path || !password) return;
    setLoad({ status: "loading" });
    void loadPdfSource(path, password).then(setLoad);
  };

  const source = load?.status === "ready" ? load.source : null;
  const pages = source ? parseRanges(ranges, source.pageCount) : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (source && pages && pages.length > 0) onInsert(source, pages);
  };

  return (
    <Dialog open={path !== null} title={t(replacing ? "tools.pages.replacePdf" : "tools.pages.insertPdf")} onClose={onClose}>
      <p className="mb-3 truncate text-sm" title={path ?? undefined}>
        {path ? basenameOf(path) : ""}
      </p>
      {load?.status === "loading" ? <p className="text-sm text-muted-foreground">{t("common.loading")}</p> : null}
      {load?.status === "error" ? <p className="text-sm text-destructive">{t("errors.INVALID_PDF")}</p> : null}
      {load?.status === "password" ? (
        <form onSubmit={retryWithPassword} className="space-y-2">
          <Field label={t("password.label")}>
            <TextInput type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="off" />
          </Field>
          {load.wrongPassword ? <p className="text-sm text-destructive">{t("password.wrong")}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
            <Button type="submit" variant="primary" disabled={!password}>{t("password.open")}</Button>
          </div>
        </form>
      ) : null}
      {source ? (
        <form onSubmit={submit} className="space-y-3">
          <Field label={t("tools.pages.pagesToInsert", { count: source.pageCount })} hint={t("tools.split.rangesHint")}>
            <TextInput value={ranges} onChange={(event) => setRanges(event.target.value)} placeholder={t("tools.allPages")} className="font-mono" aria-invalid={pages === null || undefined} />
          </Field>
          {pages === null ? <p className="text-sm text-destructive">{t("tools.pages.invalidRange")}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
            <Button type="submit" variant="primary" disabled={!pages || pages.length === 0}>
              {t(replacing ? "tools.pages.replaceCount" : "tools.pages.insertCount", { count: pages?.length ?? 0 })}
            </Button>
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}

const SHORTCUTS = [
  ["Ctrl+Z / Ctrl+Y", "undoRedo"],
  ["Delete", "delete"],
  ["R / Shift+R", "rotate"],
  ["Ctrl+D", "duplicate"],
  ["Ctrl+C / Ctrl+X / Ctrl+V", "clipboard"],
  ["S", "cut"],
  ["Shift+S", "clearCuts"],
  ["B", "insertBlank"],
  ["Ctrl+E", "extract"],
  ["Ctrl+A / Esc", "selectAllNone"],
  ["Ctrl+G", "range"],
  ["{click} / Space / Enter", "preview"],
  ["Enter / Shift+← →", "previewSelect"],
  ["Shift+F10", "contextMenu"],
  ["Shift+{click} / Ctrl+{click}", "multiSelect"],
  ["{drag}", "marquee"],
  ["← → ↑ ↓ (+Shift)", "navigate"],
  ["Alt+← → ↑ ↓ / Alt+Home / Alt+End", "nudge"],
  ["M", "move"],
  ["Home / End", "firstLast"],
  ["Ctrl+{wheel} / Ctrl +/−", "zoom"],
  ["Ctrl+Enter", "apply"],
  ["?", "help"],
] as const;

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} title={t("tools.pages.shortcuts")} onClose={onClose}>
      <dl>
        {SHORTCUTS.map(([keys, labelKey]) => (
          <div key={keys} className="flex h-row items-center justify-between gap-4 border-b text-sm last:border-b-0">
            <dt className="text-muted-foreground">{t(`tools.pages.shortcut.${labelKey}`)}</dt>
            <dd className="font-mono text-xs">{keys.replace(/\{(\w+)\}/g, (_, gesture: string) => t(`tools.pages.gesture.${gesture}`))}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}

type SourcePasswordDialogProps = {
  request: { id: string; fileName: string; wrongPassword: boolean } | null;
  busy: boolean;
  onSubmit: (password: string) => void;
  onSkip: () => void;
};

export function SourcePasswordDialog({ request, busy, onSubmit, onSkip }: SourcePasswordDialogProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const requestId = request?.id ?? null;

  useEffect(() => setPassword(""), [requestId]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (password) onSubmit(password);
  };

  return (
    <Dialog open={request !== null} title={t("password.title")} onClose={onSkip}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted-foreground">{t("tools.pages.restoredPassword", { name: request?.fileName ?? "" })}</p>
        <Field label={t("password.label")}>
          <TextInput
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="off"
            autoFocus
            aria-invalid={request?.wrongPassword || undefined}
          />
        </Field>
        {request?.wrongPassword ? (
          <p role="alert" className="text-sm text-destructive">
            {t("password.wrong")}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onSkip} disabled={busy}>
            {t("tools.pages.skipSource")}
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!password}>
            {t("password.open")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
