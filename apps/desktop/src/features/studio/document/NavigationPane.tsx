import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Heading1, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEditorState, type Editor } from "@tiptap/react";
import { Button } from "@/components/shared/Button";
import { EmptyState } from "@/components/shared/EmptyState";
import { IconButton } from "@/components/shared/IconButton";
import { cn } from "@/shared/lib/cn";
import { useDocumentViewStore } from "./documentView";
import { currentHeadingIndex, hasChildren, headingOutline, visibleHeadings } from "./headingOutline";
import { headingLabels, headingNumbersKey } from "./headingNumbers";

const INDENT: Record<number, string> = { 1: "ps-1", 2: "ps-5", 3: "ps-9", 4: "ps-13" };

export function NavigationPane({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const setNavigation = useDocumentViewStore((state) => state.setNavigation);
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  const list = useRef<HTMLUListElement>(null);
  const { outline, current } = useEditorState({
    editor,
    selector: ({ editor: shown }) => {
      const headings = headingOutline(shown.state.doc);
      const labels = headingLabels(shown.state.doc, headingNumbersKey.getState(shown.state)?.style ?? "none");
      return { outline: headings.map((heading) => ({ ...heading, number: labels.get(heading.position) ?? "" })), current: currentHeadingIndex(headings, shown.state.selection.head) };
    },
  });

  useEffect(() => {
    list.current?.querySelector("[aria-current]")?.scrollIntoView?.({ block: "nearest" });
  }, [current]);

  const toggle = (index: number) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const jump = (position: number) => {
    editor.chain().focus().setTextSelection(position + 1).run();
    const block = editor.view.nodeDOM(position);
    if (block instanceof HTMLElement) block.scrollIntoView?.({ block: "start" });
  };

  return (
    <aside aria-label={t("studio.doc.navigation.title")} className="flex w-60 shrink-0 flex-col border-e border-border bg-background" data-testid="document-navigation">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border ps-3 pe-1">
        <h2 className="flex-1 truncate text-sm font-medium">{t("studio.doc.navigation.title")}</h2>
        <IconButton icon={X} label={t("studio.doc.navigation.close")} onClick={() => setNavigation(false)} />
      </div>
      {outline.length === 0 ? (
        <EmptyState
          icon={Heading1}
          title={t("studio.doc.navigation.emptyTitle")}
          description={t("studio.doc.navigation.emptyBody")}
          action={
            <Button size="sm" onClick={() => editor.chain().focus().setHeading({ level: 1 }).run()} data-testid="document-navigation-make-heading">
              {t("studio.doc.navigation.makeHeading")}
            </Button>
          }
        />
      ) : (
        <nav aria-label={t("studio.doc.navigation.headings")} className="min-h-0 flex-1 overflow-y-auto p-2">
          <ul ref={list} className="space-y-0.5">
            {visibleHeadings(outline, collapsed).map((index) => {
              const heading = outline[index];
              const open = !collapsed.has(index);
              const label = [heading.number, heading.text || t("studio.doc.navigation.untitled")].filter(Boolean).join(" ");
              return (
                <li key={`${index}-${heading.position}`} className={cn("flex items-center gap-0.5", INDENT[heading.level])}>
                  {hasChildren(outline, index) ? (
                    <IconButton
                      icon={open ? ChevronDown : ChevronRight}
                      label={t(open ? "studio.doc.navigation.collapse" : "studio.doc.navigation.expand", { name: label })}
                      aria-expanded={open}
                      onClick={() => toggle(index)}
                      className="size-6 shrink-0"
                    />
                  ) : (
                    <span aria-hidden className="size-6 shrink-0" />
                  )}
                  <button
                    type="button"
                    aria-current={index === current ? "location" : undefined}
                    title={label}
                    onClick={() => jump(heading.position)}
                    className={cn(
                      "min-w-0 flex-1 truncate rounded-md px-2 py-1 text-start text-sm text-foreground/85 transition-colors duration-(--transition-fast) hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                      heading.level === 1 && "font-medium",
                      !heading.text && "italic text-muted-foreground",
                      index === current && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
                    )}
                    data-testid="document-navigation-heading"
                  >
                    {label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </aside>
  );
}
