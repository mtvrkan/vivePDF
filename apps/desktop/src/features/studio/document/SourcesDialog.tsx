import { useEffect, useMemo, useRef, useState } from "react";
import { BookMarked, ClipboardPaste, Download, FileSearch, FileUp, Link2, Pencil, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openExternal } from "@/shared/lib/openExternal";
import { isOffline, useOfflineHint } from "@/shared/lib/offline";
import type { Editor } from "@tiptap/react";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { IconButton } from "@/components/shared/IconButton";
import { Select } from "@/components/shared/Select";
import { Field, TextArea, TextInput } from "@/components/tool/form";
import { describeError } from "@/shared/lib/errorMessage";
import { cn } from "@/shared/lib/cn";
import { sanitizeFileName } from "@/shared/lib/naming";
import { toRpcError } from "@/shared/rpc/client";
import { checkSources, detectDoi, lookupDoi } from "@/shared/rpc/sources";
import { studioReadBibliography } from "@/shared/rpc/operations";
import { useToastStore } from "@/shared/store/toastStore";
import type { SourceCheck } from "@/types";
import type { BibEntry, CitationStyle } from "@/types/studio";
import { MAX_SOURCES, mergeSources } from "./bibtex";
import { BIBLIOGRAPHY, CITATION, citationItems, MAX_CITED, type CitationItem } from "./citationItems";
import { CITATION_STYLES, sourceSummary } from "./citations";
import { applyChanges, checkedDois, checksByDoi, doiKey, doiLink, entryOfCsl, filledDraftFields, leadingNotice, sourceChanges, STATUS_TONES, type SourceChange } from "./doiSources";
import { useDocumentStore } from "./documentStore";
import { SourceEditor } from "./SourceEditor";
import { draftOf, entryOfDraft, keyProblem, namesText, renameCitationKey, type SourceDraft } from "./sourceDraft";
import { FORMAT_EXTENSIONS, formatOfPath, parseSources, SOURCE_FILE_EXTENSIONS, SOURCE_FORMATS, writeSources, type SourceFormat } from "./sourceFormats";

const EMPTY_SOURCES: BibEntry[] = [];

function matches(entry: BibEntry, query: string): boolean {
  if (!query) return true;
  const summary = sourceSummary(entry);
  return [entry.key, summary.names, summary.year, summary.title].join(" ").toLocaleLowerCase().includes(query);
}

function editedCitation(editor: Editor): CitationItem[] | null {
  return editor.isActive(CITATION) ? citationItems(editor.getAttributes(CITATION).items) : null;
}

const TONE_CLASSES = {
  danger: "bg-destructive/10 text-destructive",
  warning: "bg-warning/15 text-warning",
  fine: "bg-success/15 text-success",
  quiet: "bg-muted text-muted-foreground",
};

const CHIP = "inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium";
const CHIP_LINK = "outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

type SourceReview = { key: string; fetched: BibEntry; changes: SourceChange[] };

function SourceBadges({ check }: { check: SourceCheck }) {
  const { t } = useTranslation();
  const notice = leadingNotice(check);
  const dates = check.notices.map((item) => [t(`studio.doc.cite.notices.${item.type}`, { defaultValue: item.type }), item.date].filter(Boolean).join(" "));
  const label = t(`studio.doc.cite.status.${check.status}`);
  const tone = TONE_CLASSES[STATUS_TONES[check.status]];
  return (
    <div className="flex flex-wrap gap-1.5 ps-3 pb-1.5" data-testid="cite-status">
      {notice ? (
        <button type="button" onClick={() => void openExternal(doiLink(notice))} title={dates.join(" · ")} className={cn(CHIP, tone, CHIP_LINK)}>
          {label}
        </button>
      ) : (
        <span className={cn(CHIP, tone)}>{label}</span>
      )}
      {check.publishedVersion ? (
        <button type="button" onClick={() => void openExternal(doiLink(check.publishedVersion ?? ""))} className={cn(CHIP, "bg-primary/10 text-primary", CHIP_LINK)}>
          {t("studio.doc.cite.publishedVersion")}
        </button>
      ) : null}
    </div>
  );
}

export function SourcesDialog({ editor, open, onClose }: { editor: Editor; open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const offlineHint = useOfflineHint();
  const sources = useDocumentStore((state) => state.document?.sources ?? EMPTY_SOURCES);
  const style = useDocumentStore((state) => state.document?.settings.citationStyle ?? "apa");
  const referencesTitle = useDocumentStore((state) => state.document?.settings.referencesTitle ?? "");
  const [editing] = useState(() => editedCitation(editor));
  const [chosen, setChosen] = useState<string[]>(() => editing?.map((item) => item.key) ?? []);
  const [locator, setLocator] = useState(() => (editing?.length === 1 ? editing[0].locator : ""));
  const [query, setQuery] = useState("");
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [draft, setDraft] = useState<SourceDraft | null>(null);
  const [draftOrigin, setDraftOrigin] = useState<string | null>(null);
  const [doiOpen, setDoiOpen] = useState(false);
  const [doiText, setDoiText] = useState("");
  const [fetching, setFetching] = useState<"doi" | "pdf" | "fill" | null>(null);
  const [checks, setChecks] = useState<Record<string, SourceCheck>>({});
  const [checking, setChecking] = useState<{ current: number; total: number } | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [review, setReview] = useState<SourceReview | null>(null);
  const checkAbort = useRef<AbortController | null>(null);
  const store = useDocumentStore.getState();
  const needle = query.trim().toLocaleLowerCase(i18n.language);
  const shown = useMemo(() => sources.filter((entry) => matches(entry, needle)), [sources, needle]);

  useEffect(() => () => checkAbort.current?.abort(), []);

  const takenKeys = new Set(sources.filter((entry) => entry.key !== draftOrigin).map((entry) => entry.key.toLowerCase()));
  const problem = draft ? keyProblem(draft.key, takenKeys) : null;

  const absorb = (text: string, format?: SourceFormat) => {
    const parsed = parseSources(text, format);
    if (parsed.entries.length === 0) {
      useToastStore.getState().push("error", t("studio.doc.cite.noEntries"));
      return false;
    }
    const merged = mergeSources(useDocumentStore.getState().document?.sources ?? [], parsed.entries);
    store.setSources(merged.sources);
    useToastStore.getState().push("success", t("studio.doc.cite.imported", { added: merged.added, updated: merged.replaced }));
    if (parsed.skipped > 0) useToastStore.getState().push("info", t("studio.doc.cite.skipped", { skipped: parsed.skipped }));
    return true;
  };

  const importFile = async () => {
    const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: t("studio.doc.cite.bibFilter"), extensions: SOURCE_FILE_EXTENSIONS }] });
    if (typeof selected !== "string") return;
    setImporting(true);
    try {
      absorb((await studioReadBibliography({ path: selected })).text, formatOfPath(selected));
    } catch (error) {
      useToastStore.getState().push("error", describeError(t, toRpcError(error)));
    } finally {
      setImporting(false);
    }
  };

  const exportSources = async () => {
    const name = sanitizeFileName(useDocumentStore.getState().document?.name.trim() ?? "") || t("studio.doc.cite.title");
    const chosenPath = await saveDialog({ defaultPath: `${name}.${FORMAT_EXTENSIONS.bibtex}`, filters: SOURCE_FORMATS.map((format) => ({ name: t(`studio.doc.cite.formats.${format}`), extensions: [FORMAT_EXTENSIONS[format]] })) });
    if (!chosenPath) return;
    const path = /\.(bib|bibtex|ris|json)$/i.test(chosenPath) ? chosenPath : `${chosenPath}.${FORMAT_EXTENSIONS.bibtex}`;
    setExporting(true);
    try {
      await invoke("write_text_file", { path, contents: writeSources(sources, formatOfPath(path)) });
      useToastStore.getState().push("success", t("studio.doc.cite.exported", { count: sources.length }));
    } catch (error) {
      useToastStore.getState().push("error", describeError(t, toRpcError(error)));
    } finally {
      setExporting(false);
    }
  };

  const failed = (error: unknown) => {
    const rpcError = toRpcError(error);
    if (rpcError.code !== "CANCELLED") useToastStore.getState().push("error", describeError(t, rpcError));
  };

  const currentSources = () => useDocumentStore.getState().document?.sources ?? [];

  const openDraft = (next: SourceDraft) => {
    setDraft(next);
    setDraftOrigin(null);
    setPasting(false);
    setDoiOpen(false);
  };

  const knownSource = (doi: string) => {
    const known = currentSources().find((entry) => entry.fields.doi && doiKey(entry.fields.doi) === doiKey(doi));
    if (!known) return false;
    useToastStore.getState().push("info", t("studio.doc.cite.alreadyAdded", { key: known.key }));
    startEditing(known.key);
    setDoiOpen(false);
    return true;
  };

  const fetchedEntry = (csl: string, taken: Set<string>) => {
    const entry = entryOfCsl(csl, taken);
    if (!entry) useToastStore.getState().push("error", t("errors.reasons.doiNoMetadata"));
    return entry;
  };

  const openFetched = (csl: string) => {
    const entry = fetchedEntry(csl, new Set(currentSources().map((item) => item.key.toLowerCase())));
    if (entry) openDraft(draftOf(entry));
    return entry !== null;
  };

  const addByDoi = async () => {
    const doi = doiText.trim();
    if (!doi || knownSource(doi)) return;
    setFetching("doi");
    try {
      if (openFetched((await lookupDoi({ doi })).csl)) setDoiText("");
    } catch (error) {
      failed(error);
    } finally {
      setFetching(null);
    }
  };

  const addFromPdf = async () => {
    const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: t("studio.doc.cite.pdfFilter"), extensions: ["pdf"] }] });
    if (typeof selected !== "string") return;
    setFetching("pdf");
    try {
      const found = await detectDoi({ path: selected });
      const partial = { ...(found.title ? { title: found.title } : {}), ...(found.doi ? { doi: found.doi } : {}) };
      if (!found.doi) {
        useToastStore.getState().push("info", t("studio.doc.cite.noDoiFound"));
        openDraft({ ...draftOf(null), fields: partial });
        return;
      }
      if (knownSource(found.doi)) return;
      if (isOffline()) {
        openDraft({ ...draftOf(null), fields: partial });
        return;
      }
      try {
        if (!openFetched((await lookupDoi({ doi: found.doi })).csl)) openDraft({ ...draftOf(null), fields: partial });
      } catch (error) {
        failed(error);
        openDraft({ ...draftOf(null), fields: partial });
      }
    } catch (error) {
      failed(error);
    } finally {
      setFetching(null);
    }
  };

  const fillDraft = async () => {
    const doi = draft?.fields.doi?.trim();
    if (!doi) return;
    setFetching("fill");
    try {
      const fetched = fetchedEntry((await lookupDoi({ doi })).csl, new Set());
      if (!fetched) return;
      setDraft((current) =>
        current
          ? {
              ...current,
              type: fetched.type,
              authors: fetched.authors.length > 0 ? namesText(fetched.authors) : current.authors,
              editors: fetched.editors.length > 0 ? namesText(fetched.editors) : current.editors,
              fields: filledDraftFields(current.fields, fetched),
            }
          : current,
      );
    } catch (error) {
      failed(error);
    } finally {
      setFetching(null);
    }
  };

  const runCheck = async () => {
    const dois = checkedDois(sources);
    if (dois.length === 0) return;
    const controller = new AbortController();
    checkAbort.current = controller;
    setChecking({ current: 0, total: dois.length });
    try {
      const result = await checkSources(
        { dois },
        {
          signal: controller.signal,
          onProgress: (progress) => {
            const current = Number(progress.detail?.current);
            if (Number.isFinite(current)) setChecking({ current, total: dois.length });
          },
        },
      );
      setChecks(checksByDoi(dois, result.items));
      const flagged = result.items.filter((item) => STATUS_TONES[item.status] === "danger" || STATUS_TONES[item.status] === "warning").length;
      useToastStore.getState().push(flagged > 0 ? "info" : "success", t(flagged > 0 ? "studio.doc.cite.checkedFlagged" : "studio.doc.cite.checkedClean", { total: result.items.length, flagged }));
    } catch (error) {
      failed(error);
    } finally {
      if (checkAbort.current === controller) checkAbort.current = null;
      setChecking(null);
    }
  };

  const startUpdate = async (entry: BibEntry) => {
    const doi = entry.fields.doi?.trim();
    if (!doi) return;
    setUpdating(entry.key);
    try {
      const fetched = fetchedEntry((await lookupDoi({ doi })).csl, new Set());
      if (!fetched) return;
      const changes = sourceChanges(entry, fetched);
      if (changes.length === 0) useToastStore.getState().push("success", t("studio.doc.cite.upToDate", { key: entry.key }));
      else setReview({ key: entry.key, fetched, changes });
    } catch (error) {
      failed(error);
    } finally {
      setUpdating(null);
    }
  };

  const applyReview = () => {
    if (!review) return;
    store.setSources(currentSources().map((entry) => (entry.key === review.key ? applyChanges(entry, review.fetched, review.changes) : entry)));
    useToastStore.getState().push("success", t("studio.doc.cite.updated", { key: review.key }));
    setReview(null);
  };

  const startEditing = (key: string | null) => {
    setDraft(draftOf(sources.find((entry) => entry.key === key) ?? null));
    setDraftOrigin(key);
    setPasting(false);
  };

  const stopEditing = () => {
    setDraft(null);
    setDraftOrigin(null);
  };

  const saveDraft = () => {
    if (!draft || problem) return;
    const current = useDocumentStore.getState().document?.sources ?? [];
    const original = current.find((entry) => entry.key === draftOrigin) ?? null;
    if (!original && current.length >= MAX_SOURCES) {
      useToastStore.getState().push("error", t("studio.doc.cite.tooMany", { limit: MAX_SOURCES }));
      return;
    }
    const entry = entryOfDraft(draft, original, new Set(current.filter((item) => item !== original).map((item) => item.key.toLowerCase())));
    if (original) {
      store.setSources(current.map((item) => (item === original ? entry : item)));
      if (entry.key !== original.key) {
        renameCitationKey(editor, original.key, entry.key);
        setChosen((keys) => keys.map((key) => (key === original.key ? entry.key : key)));
      }
    } else {
      store.setSources([...current, entry]);
      setChosen((keys) => (keys.length < MAX_CITED ? [...keys, entry.key] : keys));
    }
    stopEditing();
  };

  const addPasted = () => {
    if (absorb(pasted)) {
      setPasted("");
      setPasting(false);
    }
  };

  const toggle = (key: string) => setChosen((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key].slice(0, MAX_CITED)));

  const remove = (key: string) => {
    store.setSources(sources.filter((entry) => entry.key !== key));
    setChosen((current) => current.filter((item) => item !== key));
  };

  const cite = () => {
    const items = chosen.map((key, index) => ({ key, locator: index === chosen.length - 1 ? locator.trim() : "" }));
    if (editing) editor.chain().focus().updateAttributes(CITATION, { items }).run();
    else editor.chain().focus().insertCitation(items).run();
    onClose();
  };

  const insertList = () => {
    editor.chain().focus().insertBibliography().run();
    onClose();
  };

  const doiArea = doiOpen ? (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void addByDoi();
      }}
    >
      <Field label={t("studio.doc.cite.doiLabel")} className="min-w-0 flex-1">
        <TextInput autoFocus value={doiText} maxLength={400} spellCheck={false} placeholder="10.1038/nature12373" onChange={(event) => setDoiText(event.target.value)} className="font-mono" data-testid="cite-doi-input" />
      </Field>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => setDoiOpen(false)}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="secondary" loading={fetching === "doi"} disabled={!doiText.trim() || fetching !== null} data-testid="cite-doi-fetch">
          {t("studio.doc.cite.fetch")}
        </Button>
      </div>
      <p className="basis-full text-xs text-muted-foreground">{t("studio.doc.cite.doiHint")}</p>
    </form>
  ) : null;

  const pasteArea = pasting ? (
    <div className="space-y-2">
      <Field label={t("studio.doc.cite.pasteLabel")} hint={t("studio.doc.cite.pasteHint")}>
        <TextArea autoFocus rows={6} value={pasted} maxLength={2_000_000} onChange={(event) => setPasted(event.target.value)} className="font-mono text-xs" spellCheck={false} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setPasting(false)}>
          {t("common.cancel")}
        </Button>
        <Button variant="secondary" size="sm" disabled={!pasted.trim()} onClick={addPasted}>
          {t("studio.doc.cite.add")}
        </Button>
      </div>
    </div>
  ) : null;

  const sourceActions = (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" size="sm" icon={<FileUp className="size-4" aria-hidden />} loading={importing} onClick={() => void importFile()} data-testid="cite-import">
        {t("studio.doc.cite.importBib")}
      </Button>
      <Button variant="ghost" size="sm" icon={<ClipboardPaste className="size-4" aria-hidden />} onClick={() => setPasting(true)} aria-expanded={pasting} data-testid="cite-paste">
        {t("studio.doc.cite.paste")}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        icon={<Link2 className="size-4" aria-hidden />}
        onClick={() => {
          setDoiOpen(true);
          setPasting(false);
        }}
        aria-expanded={doiOpen}
        disabled={offlineHint !== undefined}
        title={offlineHint}
        data-testid="cite-doi"
      >
        {t("studio.doc.cite.addByDoi")}
      </Button>
      <Button variant="ghost" size="sm" icon={<FileSearch className="size-4" aria-hidden />} loading={fetching === "pdf"} disabled={fetching !== null} onClick={() => void addFromPdf()} data-testid="cite-pdf">
        {t("studio.doc.cite.addFromPdf")}
      </Button>
      <Button variant="ghost" size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => startEditing(null)} data-testid="cite-new">
        {t("studio.doc.cite.newSource")}
      </Button>
      {sources.some((entry) => entry.fields.doi?.trim()) ? (
        checking ? (
          <Button variant="ghost" size="sm" loading onClick={() => checkAbort.current?.abort()} data-testid="cite-check-cancel">
            {t("studio.doc.cite.checking", { current: checking.current, total: checking.total })}
          </Button>
        ) : (
          <Button variant="ghost" size="sm" icon={<ShieldCheck className="size-4" aria-hidden />} onClick={() => void runCheck()} disabled={offlineHint !== undefined} title={offlineHint} data-testid="cite-check">
            {t("studio.doc.cite.check")}
          </Button>
        )
      ) : null}
      {sources.length > 0 ? (
        <Button variant="ghost" size="sm" icon={<Download className="size-4" aria-hidden />} loading={exporting} onClick={() => void exportSources()} data-testid="cite-export">
          {t("studio.doc.cite.export")}
        </Button>
      ) : null}
    </div>
  );

  const editFooter = (
    <>
      <Button variant="ghost" onClick={stopEditing}>
        {t("common.cancel")}
      </Button>
      <Button variant="primary" disabled={problem !== null} onClick={saveDraft} data-testid="cite-save">
        {t("studio.doc.cite.save")}
      </Button>
    </>
  );

  const citeFooter = (
    <>
      {editor.schema.nodes[BIBLIOGRAPHY] ? (
        <Button variant="ghost" onClick={insertList} className="me-auto" data-testid="cite-insert-list">
          {t("studio.doc.cite.insertList")}
        </Button>
      ) : null}
      <Button variant="ghost" onClick={onClose}>
        {t("common.cancel")}
      </Button>
      <Button variant="primary" disabled={chosen.length === 0} onClick={cite} data-testid="cite-insert">
        {editing ? t("studio.doc.cite.update") : t("studio.doc.cite.insert")}
      </Button>
    </>
  );

  const library = (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("studio.doc.cite.style")}>
          <Select
            value={style}
            options={CITATION_STYLES.map((value) => ({ value, label: t(`studio.doc.cite.styles.${value}`) }))}
            onChange={(value) => store.setSettings({ citationStyle: value as CitationStyle })}
            ariaLabel={t("studio.doc.cite.style")}
          />
        </Field>
        <Field label={t("studio.doc.cite.referencesTitle")}>
          <TextInput value={referencesTitle} maxLength={100} placeholder={t("studio.doc.cite.referencesDefault")} onChange={(event) => store.setSettings({ referencesTitle: event.target.value })} />
        </Field>
      </div>
      {sources.length === 0 ? (
        <div className="space-y-3">
          {doiArea ?? pasteArea ?? <EmptyState icon={BookMarked} title={t("studio.doc.cite.emptyTitle")} description={t("studio.doc.cite.emptyBody")} action={sourceActions} />}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {sourceActions}
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {t("studio.doc.cite.selected", { selected: chosen.length })}
            </span>
          </div>
          {doiArea}
          {pasteArea}
          <TextInput type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("studio.doc.cite.search")} aria-label={t("studio.doc.cite.search")} />
          <ul className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-border/60 p-1" aria-label={t("studio.doc.cite.title")} data-testid="cite-sources">
            {shown.length === 0 ? <li className="px-3 py-6 text-center text-sm text-muted-foreground">{t("studio.doc.cite.noMatches")}</li> : null}
            {shown.map((entry) => {
              const summary = sourceSummary(entry);
              const picked = chosen.includes(entry.key);
              const check = entry.fields.doi ? checks[doiKey(entry.fields.doi)] : undefined;
              return (
                <li key={entry.key}>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-pressed={picked}
                      onClick={() => toggle(entry.key)}
                      className={cn("min-w-0 flex-1 rounded-lg px-3 py-2 text-start transition-colors", picked ? "bg-primary/10 inset-ring inset-ring-primary/30" : "hover:bg-muted")}
                    >
                      <span className="block truncate text-sm font-medium">{summary.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[summary.names, summary.year].filter(Boolean).join(" · ")} <span className="font-mono">@{entry.key}</span>
                      </span>
                    </button>
                    {entry.fields.doi?.trim() ? (
                      <IconButton icon={RefreshCw} label={t("studio.doc.cite.updateDetails", { key: entry.key })} busy={updating === entry.key} disabled={updating !== null || offlineHint !== undefined} onClick={() => void startUpdate(entry)} />
                    ) : null}
                    <IconButton icon={Pencil} label={t("studio.doc.cite.edit", { key: entry.key })} onClick={() => startEditing(entry.key)} />
                    <IconButton icon={Trash2} label={t("studio.doc.cite.remove", { key: entry.key })} onClick={() => remove(entry.key)} />
                  </div>
                  {check ? <SourceBadges check={check} /> : null}
                </li>
              );
            })}
          </ul>
          <Field label={t("studio.doc.cite.locator")} hint={t("studio.doc.cite.locatorHint")}>
            <TextInput value={locator} maxLength={40} onChange={(event) => setLocator(event.target.value)} />
          </Field>
        </div>
      )}
    </div>
  );

  const reviewFooter = (
    <>
      <Button variant="ghost" onClick={() => setReview(null)}>
        {t("common.cancel")}
      </Button>
      <Button variant="primary" onClick={applyReview} data-testid="cite-apply-update">
        {t("studio.doc.cite.applyUpdate")}
      </Button>
    </>
  );

  const reviewPanel = review ? (
    <div className="space-y-3" data-testid="cite-review">
      <p className="text-sm text-muted-foreground">{t("studio.doc.cite.reviewBody", { key: review.key })}</p>
      <dl className="divide-y divide-border/60 rounded-xl border border-border/60">
        {review.changes.map((change) => (
          <div key={change.field} className="grid gap-1 px-3 py-2 sm:grid-cols-4">
            <dt className="text-sm font-medium">{t(change.field === "authors" ? "studio.doc.cite.authors" : `studio.doc.cite.fields.${change.field}`)}</dt>
            <dd className="min-w-0 space-y-0.5 text-sm sm:col-span-3">
              {change.before ? (
                <del className="block break-words text-muted-foreground">
                  <span className="sr-only">{t("studio.doc.cite.before")} </span>
                  {change.before}
                </del>
              ) : null}
              <ins className="block break-words no-underline">
                <span className="sr-only">{t("studio.doc.cite.after")} </span>
                {change.after}
              </ins>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  ) : null;

  const title = review ? t("studio.doc.cite.reviewTitle") : draft ? t(draftOrigin ? "studio.doc.cite.editTitle" : "studio.doc.cite.newTitle") : t("studio.doc.cite.title");

  return (
    <Dialog open={open} onClose={onClose} size="lg" title={title} footer={review ? reviewFooter : draft ? editFooter : citeFooter}>
      {reviewPanel ?? (draft ? <SourceEditor draft={draft} problem={problem} onChange={setDraft} onFillFromDoi={() => void fillDraft()} filling={fetching === "fill"} /> : library)}
    </Dialog>
  );
}
