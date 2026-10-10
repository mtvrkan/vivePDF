import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CaseSensitive, ChevronDown, ChevronUp, Replace, WholeWord, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { TextInput } from "@/components/tool/form";
import { findMatches, replaceMatches, type TextMatch } from "./findReplace";
import { useStudioStore } from "./studioStore";
import { textEditorBridge } from "./textEditorBridge";
import { shortcutLabel } from "@/shared/lib/platform";

export type FindMode = { replace: boolean; nonce: number };

function reveal(match: TextMatch | undefined) {
  if (!match) return;
  const state = useStudioStore.getState();
  if (state.pageId !== match.pageId) state.setPage(match.pageId);
  useStudioStore.getState().select([match.elementId]);
}

export function FindReplacePanel({ mode, language, onClose }: { mode: FindMode; language: string; onClose: () => void }) {
  const { t } = useTranslation();
  const findRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const statusId = useId();
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [showReplace, setShowReplace] = useState(mode.replace);
  const [index, setIndex] = useState(-1);
  const design = useStudioStore((state) => state.design);
  const apply = useStudioStore((state) => state.apply);
  const matches = useMemo(() => (design && query ? findMatches(design, query, { matchCase, wholeWord, language }) : []), [design, query, matchCase, wholeWord, language]);
  const current = matches.length && index >= 0 ? Math.min(index, matches.length - 1) : -1;

  useEffect(() => {
    const editor = textEditorBridge.current;
    const selected = editor?.selectedText() ?? "";
    if (editor) {
      editor.commit();
      useStudioStore.getState().setEditing(null);
    }
    if (selected && !selected.includes("\n")) setQuery(selected);
    setShowReplace((shown) => shown || mode.replace);
    const target = mode.replace && selected ? replaceRef : findRef;
    requestAnimationFrame(() => {
      target.current?.focus();
      target.current?.select();
    });
  }, [mode]);

  const go = (step: 1 | -1) => {
    if (!matches.length) return;
    const next = current < 0 ? (step > 0 ? 0 : matches.length - 1) : (current + step + matches.length) % matches.length;
    setIndex(next);
    reveal(matches[next]);
  };

  const replaceOne = () => {
    const match = matches[current];
    if (!match) {
      go(1);
      return;
    }
    apply((value) => replaceMatches(value, [match], replacement));
    reveal(match);
  };

  const replaceAll = () => {
    if (!matches.length) return;
    apply((value) => replaceMatches(value, matches, replacement));
    setIndex(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  const status = !query ? "" : !matches.length ? t("studio.find.none") : current < 0 ? t("studio.find.total", { count: matches.length }) : t("studio.find.count", { current: current + 1, total: matches.length });

  return (
    <section role="search" aria-label={t("studio.find.title")} className="glass absolute right-4 top-4 z-30 w-80 space-y-2 rounded-xl border border-border/60 p-3 shadow-lg" onKeyDown={onKeyDown} data-testid="studio-find">
      <div className="flex items-center gap-1">
        <IconButton icon={Replace} label={t("studio.find.toggleReplace")} active={showReplace} aria-expanded={showReplace} onClick={() => setShowReplace((shown) => !shown)} />
        <TextInput
          ref={findRef}
          value={query}
          aria-label={t("studio.find.find")}
          aria-describedby={statusId}
          placeholder={t("studio.find.find")}
          className="h-8 min-w-0 flex-1 text-sm"
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(-1);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            go(event.shiftKey ? -1 : 1);
          }}
        />
        <IconButton icon={X} label={t("studio.find.close")} shortcut="Esc" onClick={onClose} />
      </div>
      {showReplace ? (
        <div className="flex items-center gap-1 ps-9">
          <TextInput
            ref={replaceRef}
            value={replacement}
            aria-label={t("studio.find.replaceWith")}
            placeholder={t("studio.find.replaceWith")}
            className="h-8 min-w-0 flex-1 text-sm"
            onChange={(event) => setReplacement(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (event.ctrlKey || event.metaKey) replaceAll();
              else replaceOne();
            }}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-1">
        <IconButton icon={CaseSensitive} label={t("studio.find.matchCase")} active={matchCase} onClick={() => setMatchCase((value) => !value)} />
        <IconButton icon={WholeWord} label={t("studio.find.wholeWord")} active={wholeWord} onClick={() => setWholeWord((value) => !value)} />
        <IconButton icon={ChevronUp} label={t("studio.find.previous")} shortcut="Shift+Enter" disabled={!matches.length} onClick={() => go(-1)} />
        <IconButton icon={ChevronDown} label={t("studio.find.next")} shortcut="Enter" disabled={!matches.length} onClick={() => go(1)} />
        <span id={statusId} role="status" aria-live="polite" className="ms-auto text-xs tabular-nums text-muted-foreground">
          {status}
        </span>
      </div>
      {showReplace ? (
        <div className="flex justify-end gap-2">
          <button type="button" className="glass-chip h-8 rounded-lg px-3 text-sm font-medium disabled:pointer-events-none disabled:opacity-40" disabled={!matches.length} onClick={replaceOne}>
            {t("studio.find.replace")}
          </button>
          <button type="button" className="glass-chip h-8 rounded-lg px-3 text-sm font-medium disabled:pointer-events-none disabled:opacity-40" disabled={!matches.length} onClick={replaceAll} title={`${t("studio.find.replaceAll")} (${shortcutLabel("Ctrl+Enter")})`}>
            {t("studio.find.replaceAll")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
