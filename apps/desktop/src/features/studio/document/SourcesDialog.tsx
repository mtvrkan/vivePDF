import { useMemo, useState } from "react";
import { BookMarked, ClipboardPaste, FileUp, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { Editor } from "@tiptap/react";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { IconButton } from "@/components/shared/IconButton";
import { Select } from "@/components/shared/Select";
import { Field, TextArea, TextInput } from "@/components/tool/form";
import { describeError } from "@/shared/lib/errorMessage";
import { cn } from "@/shared/lib/cn";
import { toRpcError } from "@/shared/rpc/client";
import { studioReadBibliography } from "@/shared/rpc/operations";
import { useToastStore } from "@/shared/store/toastStore";
import type { BibEntry, CitationStyle } from "@/types/studio";
import { mergeSources, parseBibtex } from "./bibtex";
import { CITATION, citationItems, MAX_CITED, type CitationItem } from "./citationItems";
import { CITATION_STYLES, sourceSummary } from "./citations";
import { useDocumentStore } from "./documentStore";

const EMPTY_SOURCES: BibEntry[] = [];
const BIB_EXTENSIONS = ["bib", "bibtex"];

function matches(entry: BibEntry, query: string): boolean {
  if (!query) return true;
  const summary = sourceSummary(entry);
  return [entry.key, summary.names, summary.year, summary.title].join(" ").toLocaleLowerCase().includes(query);
}

function editedCitation(editor: Editor): CitationItem[] | null {
  return editor.isActive(CITATION) ? citationItems(editor.getAttributes(CITATION).items) : null;
}

export function SourcesDialog({ editor, open, onClose }: { editor: Editor; open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
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
  const store = useDocumentStore.getState();
  const needle = query.trim().toLocaleLowerCase(i18n.language);
  const shown = useMemo(() => sources.filter((entry) => matches(entry, needle)), [sources, needle]);

  const absorb = (text: string) => {
    const parsed = parseBibtex(text);
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
    const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: t("studio.doc.cite.bibFilter"), extensions: BIB_EXTENSIONS }] });
    if (typeof selected !== "string") return;
    setImporting(true);
    try {
      absorb((await studioReadBibliography({ path: selected })).text);
    } catch (error) {
      useToastStore.getState().push("error", describeError(t, toRpcError(error)));
    } finally {
      setImporting(false);
    }
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
    </div>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={t("studio.doc.cite.title")}
      footer={
        <>
          <Button variant="ghost" onClick={insertList} className="me-auto" data-testid="cite-insert-list">
            {t("studio.doc.cite.insertList")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={chosen.length === 0} onClick={cite} data-testid="cite-insert">
            {editing ? t("studio.doc.cite.update") : t("studio.doc.cite.insert")}
          </Button>
        </>
      }
    >
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
            {pasteArea ?? <EmptyState icon={BookMarked} title={t("studio.doc.cite.emptyTitle")} description={t("studio.doc.cite.emptyBody")} action={sourceActions} />}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {sourceActions}
              <span className="text-xs text-muted-foreground" aria-live="polite">
                {t("studio.doc.cite.selected", { selected: chosen.length })}
              </span>
            </div>
            {pasteArea}
            <TextInput type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("studio.doc.cite.search")} aria-label={t("studio.doc.cite.search")} />
            <ul className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-border/60 p-1" aria-label={t("studio.doc.cite.title")} data-testid="cite-sources">
              {shown.length === 0 ? <li className="px-3 py-6 text-center text-sm text-muted-foreground">{t("studio.doc.cite.noMatches")}</li> : null}
              {shown.map((entry) => {
                const summary = sourceSummary(entry);
                const picked = chosen.includes(entry.key);
                return (
                  <li key={entry.key} className="flex items-center gap-1">
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
                    <IconButton icon={Trash2} label={t("studio.doc.cite.remove", { key: entry.key })} onClick={() => remove(entry.key)} />
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
    </Dialog>
  );
}
