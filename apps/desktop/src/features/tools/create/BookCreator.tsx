import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowDown, ArrowDownAZ, ArrowUp, BookOpen, FileText, ImagePlus, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/shared/Button";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { IconButton } from "@/components/shared/IconButton";
import { FileDropArea } from "@/components/tool/FileDropArea";
import { Checkbox, Field, OptionCards, Section, Segmented, SliderField, TextInput } from "@/components/tool/form";
import { OutputPathField } from "@/components/tool/OutputPathField";
import { ResultPanel } from "@/components/tool/ResultPanel";
import { ToolLayout } from "@/components/tool/ToolLayout";
import { COVER_PHOTO_EXTENSIONS, COVER_STYLES } from "@/features/tools/edit/coverShared";
import { useOperation } from "@/shared/hooks/useOperation";
import { sanitizeFileName } from "@/shared/lib/naming";
import { basenameOf, defaultOutputDirectory, dirnameOf, joinPath } from "@/shared/lib/paths";
import { createBook } from "@/shared/rpc/operations";
import { useDropTargetStore } from "@/shared/store/dropTargetStore";
import { useUiStore } from "@/shared/store/uiStore";
import type { BookPaper, CoverStyle, CreateFont } from "@/types";
import { BOOK_PAPERS, BOOK_TOC_DEPTHS, MAX_BOOK_CHAPTERS, chaptersByName, movedChapter, suggestedBookTitle, withChapters, type BookTocDepth } from "./bookDocument";
import { CREATE_FONTS, DEFAULT_ACCENT, TEXT_SOURCE_EXTENSIONS, longDate } from "./createDocument";
import { Group } from "./Group";

export function BookCreator({ modeSwitch }: { modeSwitch: ReactNode }) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const operation = useOperation(createBook);
  const [chapters, setChapters] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [author, setAuthor] = useState("");
  const [date, setDate] = useState(() => longDate(new Date(), locale));
  const [cover, setCover] = useState(true);
  const [coverStyle, setCoverStyle] = useState<CoverStyle>("classic");
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [toc, setToc] = useState(true);
  const [tocTitle, setTocTitle] = useState(() => t("tools.create.book.tocTitleDefault"));
  const [tocDepth, setTocDepth] = useState<BookTocDepth>("sections");
  const [chapterLabel, setChapterLabel] = useState(() => t("tools.create.book.chapterLabelDefault"));
  const [runningHeader, setRunningHeader] = useState(true);
  const [pageNumbers, setPageNumbers] = useState(true);
  const [font, setFont] = useState<CreateFont>("serif");
  const [fontSize, setFontSize] = useState(11);
  const [marginMm, setMarginMm] = useState(18);
  const [paper, setPaper] = useState<BookPaper>("a5");
  const [accent, setAccent] = useState(DEFAULT_ACCENT);
  const [output, setOutput] = useState("");

  const firstChapter = chapters[0];

  useEffect(() => {
    let live = true;
    const name = sanitizeFileName(title.trim()) || t("tools.create.book.defaultName");
    if (firstChapter) {
      setOutput(joinPath(dirnameOf(firstChapter), `${name}.pdf`));
      return;
    }
    void defaultOutputDirectory().then((directory) => {
      if (live) setOutput(joinPath(directory, `${name}.pdf`));
    });
    return () => {
      live = false;
    };
  }, [firstChapter, title, t]);

  const addChapters = useCallback((paths: string[]) => {
    setChapters((current) => {
      const next = withChapters(current, paths);
      if (current.length === 0 && next.length > 0) setTitle((value) => value || suggestedBookTitle(next));
      return next;
    });
  }, []);

  useEffect(() => {
    const store = useDropTargetStore.getState();
    store.setHandler(addChapters);
    return () => store.setHandler(null);
  }, [addChapters]);

  const pickChapters = async () => {
    const selected = await openDialog({ multiple: true, directory: false, filters: [{ name: t("tools.create.textFiles"), extensions: TEXT_SOURCE_EXTENSIONS }] });
    if (Array.isArray(selected)) addChapters(selected);
    else if (typeof selected === "string") addChapters([selected]);
  };

  const pickCoverImage = async () => {
    const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: t("tools.create.book.coverImage"), extensions: COVER_PHOTO_EXTENSIONS }] });
    if (typeof selected === "string") setCoverImage(selected);
  };

  const needsPicture = cover && coverStyle === "photo" && !coverImage;
  const ready = chapters.length > 0 && title.trim().length > 0 && output.length > 0 && !needsPicture;

  const run = () => {
    if (!ready) return;
    void operation.run({
      chapters,
      title,
      subtitle,
      author,
      date,
      cover,
      coverStyle,
      coverImage: cover && coverStyle === "photo" && coverImage ? coverImage : undefined,
      toc,
      tocTitle,
      tocDepth: tocDepth === "chapters" ? 1 : 2,
      chapterLabel,
      runningHeader,
      pageNumbers,
      font,
      fontSize,
      marginMm,
      accent,
      paper,
      output,
    });
  };

  const result = operation.result;

  return (
    <ToolLayout
      title={t("tools.create.book.title")}
      icon={BookOpen}
      description={t("tools.create.book.description")}
      actions={
        <Button variant="primary" onClick={run} loading={operation.running} disabled={!ready}>
          {t("tools.create.book.run")}
        </Button>
      }
      form={
        <fieldset disabled={operation.running} className="contents">
          <Section>{modeSwitch}</Section>
          <Section title={t("tools.create.book.chapters")}>
            {chapters.length === 0 ? (
              <FileDropArea title={t("tools.create.book.pickTitle")} description={t("tools.create.book.pickDescription")} icon={FileText} onPick={() => void pickChapters()} />
            ) : (
              <>
                <ol className="space-y-2">
                  {chapters.map((path, index) => (
                    <li key={path} className="glass-chip flex h-11 items-center gap-3 rounded-xl ps-2 pe-1.5 text-sm">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted font-mono text-xs font-semibold tabular-nums">{index + 1}</span>
                      <span className="min-w-0 flex-1 truncate font-medium" title={path}>
                        {basenameOf(path)}
                      </span>
                      <IconButton icon={ArrowUp} label={t("tools.merge.moveUp")} disabled={index === 0} onClick={() => setChapters((state) => movedChapter(state, index, -1))} />
                      <IconButton icon={ArrowDown} label={t("tools.merge.moveDown")} disabled={index === chapters.length - 1} onClick={() => setChapters((state) => movedChapter(state, index, 1))} />
                      <IconButton icon={X} label={t("tools.create.book.removeChapter", { name: basenameOf(path) })} onClick={() => setChapters((state) => state.filter((entry) => entry !== path))} />
                    </li>
                  ))}
                </ol>
                <div className="flex flex-wrap items-center gap-3">
                  <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => void pickChapters()} disabled={chapters.length >= MAX_BOOK_CHAPTERS}>
                    {t("tools.create.book.addChapters")}
                  </Button>
                  <IconButton icon={ArrowDownAZ} label={t("tools.merge.sortByName")} disabled={chapters.length < 2} onClick={() => setChapters((state) => chaptersByName(state, locale))} />
                  <Button variant="ghost" onClick={() => setChapters([])}>
                    {t("tools.batch.clear")}
                  </Button>
                </div>
              </>
            )}
            <p className="text-xs text-muted-foreground">{t("tools.create.book.chaptersHint")}</p>
          </Section>
          <Section title={t("tools.create.details")}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("tools.create.fields.title")}>
                <TextInput value={title} maxLength={300} onChange={(event) => setTitle(event.target.value)} aria-label={t("tools.create.fields.title")} />
              </Field>
              <Field label={t("tools.create.book.subtitle")}>
                <TextInput value={subtitle} maxLength={300} onChange={(event) => setSubtitle(event.target.value)} aria-label={t("tools.create.book.subtitle")} />
              </Field>
              <Field label={t("tools.create.fields.author")}>
                <TextInput value={author} maxLength={300} onChange={(event) => setAuthor(event.target.value)} aria-label={t("tools.create.fields.author")} />
              </Field>
              <Field label={t("tools.create.fields.date")}>
                <TextInput value={date} maxLength={80} onChange={(event) => setDate(event.target.value)} aria-label={t("tools.create.fields.date")} />
              </Field>
            </div>
          </Section>
          <Section title={t("tools.create.book.coverSection")}>
            <Checkbox label={t("tools.create.book.cover")} checked={cover} onChange={setCover} />
            {cover ? (
              <>
                <OptionCards
                  value={coverStyle}
                  onChange={setCoverStyle}
                  ariaLabel={t("tools.create.book.coverSection")}
                  options={COVER_STYLES.map((value) => ({ value, title: t(`tools.edit.cover.styles.${value}.title`), description: t(`tools.edit.cover.styles.${value}.description`) }))}
                />
                {coverStyle === "photo" ? (
                  <Group label={t("tools.create.book.coverImage")} hint={t("tools.create.book.coverImageHint")}>
                    {coverImage ? (
                      <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                        <ImagePlus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1 truncate" title={coverImage}>
                          {basenameOf(coverImage)}
                        </span>
                        <IconButton icon={X} label={t("tools.create.book.removeCoverImage")} onClick={() => setCoverImage(null)} />
                      </div>
                    ) : (
                      <Button size="sm" icon={<ImagePlus className="size-4" aria-hidden />} onClick={() => void pickCoverImage()}>
                        {t("tools.create.book.pickCoverImage")}
                      </Button>
                    )}
                  </Group>
                ) : null}
              </>
            ) : null}
          </Section>
          <Section title={t("tools.create.book.structure")}>
            <Checkbox label={t("tools.create.book.toc")} checked={toc} onChange={setToc} />
            {toc ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("tools.create.book.tocTitle")}>
                  <TextInput value={tocTitle} maxLength={100} onChange={(event) => setTocTitle(event.target.value)} aria-label={t("tools.create.book.tocTitle")} />
                </Field>
                <Field label={t("tools.create.book.tocDepth")}>
                  <Segmented value={tocDepth} options={BOOK_TOC_DEPTHS} labelOf={(value) => t(`tools.create.book.depths.${value}`)} onChange={setTocDepth} ariaLabel={t("tools.create.book.tocDepth")} />
                </Field>
              </div>
            ) : null}
            <Field label={t("tools.create.book.chapterLabel")} hint={t("tools.create.book.chapterLabelHint")}>
              <TextInput value={chapterLabel} maxLength={60} onChange={(event) => setChapterLabel(event.target.value)} className="w-56" aria-label={t("tools.create.book.chapterLabel")} />
            </Field>
            <Checkbox label={t("tools.create.book.runningHeader")} checked={runningHeader} onChange={setRunningHeader} />
            <Checkbox label={t("tools.create.pageNumbers")} checked={pageNumbers} onChange={setPageNumbers} />
          </Section>
          <Section title={t("tools.create.look")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("tools.create.font")}>
                <Segmented value={font} options={CREATE_FONTS} labelOf={(value) => t(`tools.create.fonts.${value}`)} onChange={setFont} ariaLabel={t("tools.create.font")} />
              </Field>
              <Field label={t("tools.create.paper")}>
                <Segmented value={paper} options={BOOK_PAPERS} labelOf={(value) => t(`tools.create.book.papers.${value}`)} onChange={setPaper} ariaLabel={t("tools.create.paper")} />
              </Field>
              <SliderField label={t("tools.create.fontSize")} value={fontSize} min={9} max={14} step={0.5} onChange={setFontSize} format={(value) => `${value} pt`} />
              <SliderField label={t("tools.create.margins")} value={marginMm} min={10} max={35} onChange={setMarginMm} format={(value) => `${value} mm`} />
            </div>
            <Group label={t("tools.create.accent")}>
              <ColorSwatch value={accent} onChange={setAccent} label={t("tools.create.accent")} customLabel={t("tools.create.customColor")} />
            </Group>
          </Section>
          <Section>
            <OutputPathField value={output} onChange={setOutput} disabled={operation.running} />
          </Section>
        </fieldset>
      }
      result={
        <ResultPanel
          status={operation.status}
          progress={operation.progress}
          error={operation.error}
          numeral={result ? String(result.pageCount) : undefined}
          caption={result ? t("tools.create.resultCaption", { count: result.pageCount }) : undefined}
          outputs={result ? [result.output] : []}
          idleIcon={BookOpen}
          idleTitle={t("tools.create.book.idle.title")}
          idleDescription={t("tools.create.book.idle.description")}
          onCancel={operation.cancel}
          onRetry={run}
          overwritePrompt={operation.overwritePrompt}
          onConfirmOverwrite={operation.confirmOverwrite}
          onDismissOverwrite={operation.dismissOverwrite}
        />
      }
    />
  );
}
