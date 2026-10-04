import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { useLocation } from "react-router";
import { ArrowDown, ArrowDown01, ArrowDownAZ, ArrowUp, ArrowUpDown, Combine, FileText, FlipVertical2, FolderPlus, GripVertical, LayoutGrid, Lock, Plus, TextCursorInput, X, FileInput } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { Checkbox, Field, OptionCards, Section, SelectInput, SwitchField, TextInput } from "@/components/tool/form";
import { OutputPathField } from "@/components/tool/OutputPathField";
import { PagePickerDialog } from "@/components/tool/PagePickerDialog";
import { ResultPanel } from "@/components/tool/ResultPanel";
import { ToolLayout } from "@/components/tool/ToolLayout";
import { useOperation } from "@/shared/hooks/useOperation";
import { cn } from "@/shared/lib/cn";
import { formatNumber } from "@/shared/lib/format";
import { basenameOf, suggestOutputPath, extensionOf } from "@/shared/lib/paths";
import { isPdfPath } from "@/shared/rpc/files";
import { getDocumentInfo } from "@/shared/rpc/documents";
import { toRpcError } from "@/shared/rpc/client";
import { listPdfs, mergePdfs } from "@/shared/rpc/operations";
import { describeError } from "@/shared/lib/errorMessage";
import { useToastStore } from "@/shared/store/toastStore";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useLaunchStore } from "@/shared/store/launchStore";
import { useUiStore } from "@/shared/store/uiStore";
import { pagesInRanges } from "@/shared/lib/pageRanges";
import { pagesToRanges } from "@/shared/lib/pageScope";
import { mergedPageTotal, moveToSlot, sortedByName, sortedByPageCount } from "./pageRanges";
import { withoutListed } from "./mergeFiles";
import { DropZone } from "@/components/tool/DropZone";
import { FileDropArea } from "@/components/tool/FileDropArea";
import { useDropHandler } from "@/shared/hooks/useDropHandler";
import { EBOOK_EXTENSIONS, MAIL_EXTENSIONS, OFFICE_LIKE_EXTENSIONS, TEXT_LIKE_EXTENSIONS } from "@/features/tools/convert/conversions";
import type { MergeBookmarkStyle } from "@/types";

type MergeItem = { id: string; path: string; ranges: string; password?: string; locked?: boolean; wrongPassword?: boolean; pageCount?: number; reverse?: boolean; protected?: boolean; unreadable?: boolean };
type MergeMode = "append" | "interleave";

const MERGEABLE_EXTENSIONS = ["pdf", ...OFFICE_LIKE_EXTENSIONS, ...TEXT_LIKE_EXTENSIONS, ...EBOOK_EXTENSIONS, ...MAIL_EXTENSIONS, "png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff", "heic", "heif"];
const MERGE_MODES: MergeMode[] = ["append", "interleave"];
const BOOKMARK_STYLES: MergeBookmarkStyle[] = ["nested", "files", "originals", "none"];
const PROBE_CONCURRENCY = 3;

function isMergeable(path: string): boolean {
  return MERGEABLE_EXTENSIONS.includes(extensionOf(path).toLowerCase());
}

function freshItem(path: string, password?: string): MergeItem {
  return { id: crypto.randomUUID(), path, ranges: "", password };
}

function LockedRow({ item, onUnlock, disabled }: { item: MergeItem; onUnlock: (id: string, password: string) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (password) onUnlock(item.id, password);
  };
  return (
    <form onSubmit={submit} className="flex shrink-0 items-center gap-2">
      <Lock className="size-4 shrink-0 text-warning" aria-hidden />
      <span className="w-32">
        <TextInput
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={t("password.label")}
          aria-label={t("password.label")}
          className="h-8 rounded-lg bg-background/60 text-xs"
        />
      </span>
      <Button size="sm" type="submit" variant="primary" disabled={!password || disabled}>
        {t("password.open")}
      </Button>
      {item.wrongPassword ? <span className="text-xs text-destructive">{t("password.wrong")}</span> : null}
    </form>
  );
}

export function MergePage() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const documents = useDocumentStore((state) => state.documents);
  const operation = useOperation(mergePdfs);
  const pushToast = useToastStore((state) => state.push);
  const [items, setItems] = useState<MergeItem[]>(() => {
    const open = Object.values(documents);
    const { fresh } = withoutListed([], open.map((doc) => doc.path));
    return fresh.map((path) => freshItem(path, open.find((doc) => doc.path === path)?.password ?? undefined));
  });
  const [includeSubfolders, setIncludeSubfolders] = useState(false);
  const [scanningFolder, setScanningFolder] = useState(false);
  const itemsRef = useRef(items);
  useLayoutEffect(() => {
    itemsRef.current = items;
  });
  const [bookmarks, setBookmarks] = useState<MergeBookmarkStyle>("nested");
  const [contentsPage, setContentsPage] = useState(false);
  const [mode, setMode] = useState<MergeMode>("append");
  const [padOdd, setPadOdd] = useState(false);
  const [keepProtection, setKeepProtection] = useState(true);
  const [output, setOutput] = useState("");
  const initialItems = useRef(items);

  const probe = useCallback(async (entries: Array<{ path: string; password?: string }>) => {
    const queue = entries.filter((entry) => isPdfPath(entry.path));
    const probeOne = async (entry: { path: string; password?: string }) => {
      try {
        const info = await getDocumentInfo({ path: entry.path, password: entry.password });
        setItems((state) => state.map((item) => (item.path === entry.path ? { ...item, pageCount: info.pageCount, protected: info.encrypted, unreadable: false } : item)));
      } catch (error) {
        const locked = toRpcError(error).code === "NEEDS_PASSWORD";
        setItems((state) =>
          state.map((item) => (item.path !== entry.path || item.password ? item : locked ? { ...item, locked: true, protected: true } : { ...item, unreadable: true })),
        );
      }
    };
    const worker = async () => {
      for (let entry = queue.shift(); entry; entry = queue.shift()) await probeOne(entry);
    };
    await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, queue.length) }, worker));
  }, []);

  const addPaths = useCallback(
    (paths: string[]) => {
      const accepted = paths.filter(isMergeable);
      if (accepted.length === 0) return;
      const { fresh, repeated } = withoutListed(itemsRef.current.map((item) => item.path), accepted);
      if (repeated > 0) pushToast("info", t("tools.merge.alreadyListed", { count: repeated }));
      if (fresh.length === 0) return;
      itemsRef.current = [...itemsRef.current, ...fresh.map((path) => freshItem(path))];
      setItems((state) => [...state, ...withoutListed(state.map((item) => item.path), fresh).fresh.map((path) => freshItem(path))]);
      void probe(fresh.map((path) => ({ path })));
    },
    [probe, pushToast, t],
  );

  const folderContents = useCallback(
    async (folder: string): Promise<string[]> => {
      try {
        const listed = await listPdfs({ folder, recursive: includeSubfolders });
        if (listed.files.length === 0) pushToast("info", t("tools.batch.folderEmpty", { name: basenameOf(folder) || folder }));
        if (listed.truncated) pushToast("info", t("tools.batch.folderTruncated", { count: listed.files.length }));
        return listed.files;
      } catch (error) {
        const rpcError = toRpcError(error);
        if (rpcError.code !== "FILE_NOT_FOUND") pushToast("error", describeError(t, rpcError));
        return [];
      }
    },
    [includeSubfolders, pushToast, t],
  );

  const addDropped = useCallback(
    (paths: string[]) => {
      if (paths.every(isMergeable)) {
        addPaths(paths);
        return;
      }
      setScanningFolder(true);
      void Promise.all(paths.map((path) => (isMergeable(path) ? Promise.resolve([path]) : folderContents(path))))
        .then((groups) => addPaths(groups.flat()))
        .finally(() => setScanningFolder(false));
    },
    [addPaths, folderContents],
  );

  const unlock = useCallback(async (id: string, password: string) => {
    const target = items.find((item) => item.id === id);
    if (!target) return;
    try {
      const info = await getDocumentInfo({ path: target.path, password });
      setItems((state) => state.map((item) => (item.id === id ? { ...item, password, locked: false, wrongPassword: false, pageCount: info.pageCount, protected: true } : item)));
    } catch {
      setItems((state) => state.map((item) => (item.id === id ? { ...item, wrongPassword: true } : item)));
    }
  }, [items]);
  useDropHandler(addDropped);

  useEffect(() => {
    void probe(initialItems.current);
  }, [probe]);

  const pendingPath = useLaunchStore((state) => state.pendingPath);
  const pendingPaths = useLaunchStore((state) => state.pendingPaths);
  const { pathname } = useLocation();

  useEffect(() => {
    if (!pendingPath && pendingPaths.length === 0) return;
    const store = useLaunchStore.getState();
    const launched = store.consumeAll(isMergeable, pathname);
    const single = launched.length > 0 ? null : store.consumeIf(isMergeable, pathname);
    const paths = single ? [single] : launched;
    if (paths.length > 0) addPaths(paths);
  }, [pendingPath, pendingPaths, pathname, addPaths]);

  useEffect(() => {
    if (items.length === 0 && output) setOutput("");
    else if (items.length > 0 && !output) setOutput(suggestOutputPath(items[0].path, t("tools.merge.suffix")));
  }, [items, output, t]);

  const addFiles = async () => {
    const selected = await openDialog({ multiple: true, directory: false, filters: [{ name: t("tools.convert.anyDocument"), extensions: MERGEABLE_EXTENSIONS }, { name: "PDF", extensions: ["pdf"] }] });
    if (!selected) return;
    addPaths(Array.isArray(selected) ? selected : [selected]);
  };

  const addFolder = async () => {
    const selected = await openDialog({ multiple: false, directory: true });
    if (typeof selected !== "string") return;
    setScanningFolder(true);
    try {
      addPaths(await folderContents(selected));
    } finally {
      setScanningFolder(false);
    }
  };

  const listRef = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<{ id: string; slot: number } | null>(null);
  const [pickerId, setPickerId] = useState<string | null>(null);
  const pickerItem = items.find((item) => item.id === pickerId && item.pageCount !== undefined) ?? null;

  const slotAt = (clientY: number) => {
    const rows = listRef.current ? Array.from(listRef.current.children) : [];
    const index = rows.findIndex((row) => {
      const rect = row.getBoundingClientRect();
      return clientY < rect.top + rect.height / 2;
    });
    return index < 0 ? rows.length : index;
  };

  const startDrag = (event: PointerEvent<HTMLButtonElement>, id: string, index: number) => {
    if (event.button !== 0 || operation.running) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ id, slot: index });
  };

  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    const slot = slotAt(event.clientY);
    if (slot !== drag.slot) setDrag({ ...drag, slot });
  };

  const endDrag = () => {
    if (!drag) return;
    setItems((state) => moveToSlot(state, drag.id, drag.slot));
    setDrag(null);
  };

  const move = (index: number, delta: number) =>
    setItems((state) => {
      const next = [...state];
      const target = index + delta;
      if (target < 0 || target >= next.length) return state;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const interleave = mode === "interleave";
  const locked = items.some((item) => item.locked);
  const counted = items.map((item) => (item.pageCount === undefined ? null : pagesInRanges(item.ranges, item.pageCount)));
  const total = counted.every((count) => count !== null) ? mergedPageTotal(counted as number[], interleave, padOdd) : null;
  const anyUnknown = items.some((item) => isPdfPath(item.path) && item.pageCount === undefined && !item.locked);
  const badRanges = counted.some((count, index) => count === null && items[index].pageCount !== undefined);
  const unreadable = items.some((item) => item.unreadable);
  const dragFrom = drag ? items.findIndex((item) => item.id === drag.id) : -1;
  const showSlot = drag !== null && drag.slot !== dragFrom && drag.slot !== dragFrom + 1;
  const tooFewToInterleave = interleave && items.length < 2;
  const firstProtected = items.find((item) => item.protected);
  const blocked = items.length < 1 || !output || locked || badRanges || unreadable || tooFewToInterleave;

  const run = () => {
    if (blocked) return;
    void operation.run({
      inputs: items.map((item) => ({ path: item.path, ranges: item.ranges.trim() || undefined, password: item.password, reverse: item.reverse || undefined })),
      output,
      bookmarks,
      contentsPage: contentsPage && !interleave,
      contentsTitle: t("tools.merge.contents.pageTitle"),
      interleave,
      padOdd: !interleave && padOdd,
      keepProtection: firstProtected ? keepProtection : undefined,
    });
  };

  return (
    <ToolLayout
      title={t("nav.merge")}
      icon={Combine}
      description={t("tools.merge.description")}
      actions={
        <Button variant="primary" onClick={run} loading={operation.running} disabled={blocked}>
          {t("tools.merge.run")}
        </Button>
      }
      form={
        <>
          <Section title={t("tools.merge.files")}>
            <DropZone label={t("tools.dropZone.pdfs")}>
            {items.length === 0 ? (
              <FileDropArea title={t("tools.batch.dropTitle")} description={t("tools.merge.empty.description")} onPick={() => void addFiles()} disabled={operation.running || scanningFolder} />
            ) : (
              <ol ref={listRef} className="space-y-2">
                {items.map((item, index) => (
                  <li key={item.id} className={cn("glass-chip relative flex h-12 items-center gap-3 rounded-xl ps-1 pe-1.5 text-sm", drag?.id === item.id && "opacity-60")}>
                    {showSlot && drag?.slot === index ? <span aria-hidden className="pointer-events-none absolute inset-x-2 -top-1.5 h-0.5 rounded-full bg-primary" /> : null}
                    {showSlot && drag?.slot === items.length && index === items.length - 1 ? <span aria-hidden className="pointer-events-none absolute inset-x-2 -bottom-1.5 h-0.5 rounded-full bg-primary" /> : null}
                    <button
                      type="button"
                      aria-label={t("tools.merge.dragHandle", { name: basenameOf(item.path) })}
                      title={t("tools.merge.dragHint")}
                      disabled={operation.running || items.length < 2}
                      onPointerDown={(event) => startDrag(event, item.id, index)}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={() => setDrag(null)}
                      className="flex h-8 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing disabled:cursor-default disabled:opacity-40"
                    >
                      <GripVertical className="size-4" aria-hidden />
                    </button>
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-(--tone-soft) font-mono text-xs font-semibold tabular-nums text-(--tone)">{index + 1}</span>
                    <span className="flex min-w-20 flex-1 items-center gap-2" title={item.path}>
                      {isPdfPath(item.path) ? <FileText className="size-4 shrink-0 text-(--tone)" aria-hidden /> : <FileInput className="size-4 shrink-0 text-warning" aria-hidden />}
                      <span title={basenameOf(item.path)} className="truncate font-medium">{basenameOf(item.path)}</span>
                    </span>
                    {item.locked ? <LockedRow item={item} onUnlock={(id, password) => void unlock(id, password)} disabled={operation.running} /> : null}
                    <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      <span className="hidden xl:inline">{t("tools.merge.ranges")}</span>
                      <span className="w-28">
                        <TextInput
                          value={item.ranges}
                          onChange={(event) => setItems((state) => state.map((entry) => (entry.id === item.id ? { ...entry, ranges: event.target.value } : entry)))}
                          placeholder={t("tools.merge.rangesPlaceholder")}
                          aria-label={t("tools.merge.ranges")}
                          aria-invalid={(counted[index] === null && item.pageCount !== undefined) || undefined}
                          className="h-8 rounded-lg bg-background/60 font-mono text-xs"
                        />
                      </span>
                    </label>
                    <span className={cn("w-28 shrink-0 text-end text-xs tabular-nums", counted[index] === null && item.pageCount !== undefined ? "text-destructive" : "font-mono text-muted-foreground")}>
                      {item.unreadable
                        ? t("tools.merge.unreadable")
                        : item.pageCount === undefined
                        ? ""
                        : counted[index] === null
                          ? t("tools.merge.rangeInvalid")
                          : item.ranges.trim() && counted[index] !== item.pageCount
                            ? `${counted[index]} / ${item.pageCount}`
                            : formatNumber(item.pageCount, locale)}
                    </span>
                    <IconButton
                      icon={LayoutGrid}
                      label={t("tools.merge.choosePages", { name: basenameOf(item.path) })}
                      disabled={item.pageCount === undefined || operation.running}
                      onClick={() => setPickerId(item.id)}
                    />
                    <IconButton
                      icon={FlipVertical2}
                      label={t("tools.merge.reversePages")}
                      active={!!item.reverse}
                      disabled={operation.running}
                      onClick={() => setItems((state) => state.map((entry) => (entry.id === item.id ? { ...entry, reverse: !entry.reverse } : entry)))}
                    />
                    <span className="mx-1 h-5 w-px bg-border" aria-hidden />
                    <IconButton icon={ArrowUp} label={t("tools.merge.moveUp")} disabled={index === 0 || operation.running} onClick={() => move(index, -1)} />
                    <IconButton icon={ArrowDown} label={t("tools.merge.moveDown")} disabled={index === items.length - 1 || operation.running} onClick={() => move(index, 1)} />
                    <IconButton icon={X} label={t("tools.merge.removeFile", { name: basenameOf(item.path) })} disabled={operation.running} onClick={() => setItems((state) => state.filter((entry) => entry.id !== item.id))} />
                  </li>
                ))}
              </ol>
            )}
            </DropZone>
            <div className="flex flex-wrap items-center gap-3">
              {items.length > 0 ? (
                <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => void addFiles()} disabled={operation.running || scanningFolder}>
                  {t("tools.merge.addFiles")}
                </Button>
              ) : null}
              <Button icon={<FolderPlus className="size-4" aria-hidden />} onClick={() => void addFolder()} loading={scanningFolder} disabled={operation.running || scanningFolder}>
                {t("tools.batch.addFolder")}
              </Button>
              <Checkbox label={t("tools.batch.includeSubfolders")} checked={includeSubfolders} onChange={setIncludeSubfolders} disabled={operation.running || scanningFolder} />
              {items.length > 0 ? (
                <>
                  <IconButton icon={ArrowDownAZ} label={t("tools.merge.sortByName")} disabled={items.length < 2 || operation.running} onClick={() => setItems((state) => sortedByName(state, locale, basenameOf))} />
                  <IconButton icon={ArrowDown01} label={t("tools.merge.sortByPages")} disabled={items.length < 2 || operation.running} onClick={() => setItems((state) => sortedByPageCount(state))} />
                  <IconButton icon={ArrowUpDown} label={t("tools.merge.reverseOrder")} disabled={items.length < 2 || operation.running} onClick={() => setItems((state) => [...state].reverse())} />
                  <Button variant="ghost" onClick={() => setItems([])} disabled={operation.running}>
                    {t("tools.batch.clear")}
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {anyUnknown ? t("tools.merge.totalUnknown") : total === null ? "" : t("tools.merge.total", { count: total })}
                  </span>
                </>
              ) : null}
            </div>
          </Section>
          <Section title={t("tools.merge.mode")}>
            <OptionCards
              value={mode}
              onChange={setMode}
              ariaLabel={t("tools.merge.mode")}
              options={MERGE_MODES.map((value) => ({ value, title: t(`tools.merge.modes.${value}.title`), description: t(`tools.merge.modes.${value}.description`) }))}
            />
            {tooFewToInterleave ? <p className="text-xs text-warning">{t("tools.merge.interleaveNeedsTwo")}</p> : null}
            <Field label={t("tools.merge.bookmarks")} hint={t(`tools.merge.bookmarkStyles.${bookmarks}Hint`)}>
              <SelectInput value={bookmarks} onChange={(event) => setBookmarks(event.target.value as MergeBookmarkStyle)} aria-label={t("tools.merge.bookmarks")} className="w-72">
                {BOOKMARK_STYLES.map((style) => (
                  <option key={style} value={style}>
                    {t(`tools.merge.bookmarkStyles.${style}`)}
                  </option>
                ))}
              </SelectInput>
            </Field>
            {interleave ? null : <Checkbox label={t("tools.merge.contents.label")} hint={t("tools.merge.contents.hint")} checked={contentsPage} onChange={setContentsPage} />}
            {interleave ? null : <Checkbox label={t("tools.merge.padOdd")} hint={t("tools.merge.padOddHint")} checked={padOdd} onChange={setPadOdd} />}
            {firstProtected ? <SwitchField label={t("tools.merge.keepProtection")} hint={t("tools.merge.keepProtectionHint", { name: basenameOf(firstProtected.path) })} checked={keepProtection} onChange={setKeepProtection} /> : null}
          </Section>
          <Section>
            <OutputPathField value={output} onChange={setOutput} disabled={operation.running} />
          </Section>
          {pickerItem ? (
            <PagePickerDialog
              open
              title={t("tools.merge.pickerTitle", { name: basenameOf(pickerItem.path) })}
              path={pickerItem.path}
              password={pickerItem.password}
              pageCount={pickerItem.pageCount as number}
              ranges={pickerItem.ranges}
              onClose={() => setPickerId(null)}
              onApply={(pages) => {
                const ranges = pages.length === pickerItem.pageCount ? "" : pagesToRanges(pages);
                setItems((state) => state.map((entry) => (entry.id === pickerItem.id ? { ...entry, ranges } : entry)));
                setPickerId(null);
              }}
            />
          ) : null}
        </>
      }
      result={
        <ResultPanel
          status={operation.status}
          progress={operation.progress}
          error={operation.error}
          numeral={operation.result ? formatNumber(operation.result.pageCount, locale) : undefined}
          caption={operation.result ? t("info.pages") : undefined}
          outputs={operation.result ? [operation.result.output] : []}
          outputPassword={operation.result?.protectedFrom ? firstProtected?.password : undefined}
          idleIcon={Combine}
          idleTitle={t("tools.merge.idle.title")}
          idleDescription={t("tools.merge.idle.description")}
          onCancel={operation.cancel}
          onRetry={run}
          overwritePrompt={operation.overwritePrompt}
          onConfirmOverwrite={operation.confirmOverwrite}
          onDismissOverwrite={operation.dismissOverwrite}
        >
          {operation.result?.protectedFrom ? (
            <p role="status" className="flex items-center gap-2 px-4 py-2.5 text-sm text-muted-foreground">
              <Lock className="size-4 shrink-0" aria-hidden />
              {t("tools.merge.protectedFrom", { name: operation.result.protectedFrom })}
            </p>
          ) : null}
          {operation.result && operation.result.renamedFields > 0 ? (
            <p role="status" className="flex items-center gap-2 px-4 py-2.5 text-sm text-muted-foreground">
              <TextCursorInput className="size-4 shrink-0" aria-hidden />
              {t("tools.merge.renamedFields", { count: operation.result.renamedFields })}
            </p>
          ) : null}
        </ResultPanel>
      }
    />
  );
}
