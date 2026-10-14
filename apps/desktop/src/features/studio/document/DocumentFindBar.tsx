import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { CaseSensitive, ChevronDown, ChevronUp, Replace, WholeWord, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEditorState, type Editor } from "@tiptap/react";
import { IconButton } from "@/components/shared/IconButton";
import { TextInput } from "@/components/tool/form";
import { shortcutLabel } from "@/shared/lib/platform";
import { findState, replaceAllMatches, replaceMatch, revealMatch, setFind } from "./findInDocument";

export type DocumentFindMode = { replace: boolean; nonce: number };

export function DocumentFindBar({ editor, mode, language, onClose }: { editor: Editor; mode: DocumentFindMode; language: string; onClose: () => void }) {
  const { t } = useTranslation();
  const findRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const statusId = useId();
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [showReplace, setShowReplace] = useState(mode.replace);
  const found = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const state = findState(current.state);
      return { count: state?.matches.length ?? 0, current: state?.current ?? -1 };
    },
  });
  const options = { matchCase, wholeWord, language };

  useEffect(() => {
    const { from, to } = editor.state.selection;
    const selected = from === to ? "" : editor.state.doc.textBetween(from, to, "\n");
    if (selected && !selected.includes("\n")) setQuery(selected);
    setShowReplace((shown) => shown || mode.replace);
    const target = mode.replace && selected ? replaceRef : findRef;
    requestAnimationFrame(() => {
      target.current?.focus();
      target.current?.select();
    });
  }, [mode, editor]);

  useEffect(() => {
    editor.view.dispatch(setFind(editor.state.tr, { query, options: { matchCase, wholeWord, language }, current: -1 }));
  }, [editor, query, matchCase, wholeWord, language]);

  useEffect(
    () => () => {
      if (!editor.isDestroyed) editor.view.dispatch(setFind(editor.state.tr, { query: "", options: { matchCase: false, wholeWord: false, language }, current: -1 }));
    },
    [editor, language],
  );

  const go = (step: 1 | -1) => {
    const state = findState(editor.state);
    if (!state?.matches.length) return;
    const total = state.matches.length;
    const next = state.current < 0 ? (step > 0 ? 0 : total - 1) : (state.current + step + total) % total;
    editor.view.dispatch(revealMatch(setFind(editor.state.tr, { query, options, current: next }), state.matches[next]));
  };

  const replaceOne = () => {
    const state = findState(editor.state);
    const match = state && state.current >= 0 ? state.matches[state.current] : undefined;
    if (!match) {
      go(1);
      return;
    }
    editor.view.dispatch(setFind(replaceMatch(editor.state.tr, match, replacement), { query, options, current: state?.current ?? -1 }));
    const after = findState(editor.state);
    const next = after && after.current >= 0 ? after.matches[after.current] : undefined;
    if (next) editor.view.dispatch(revealMatch(editor.state.tr, next));
  };

  const replaceAll = () => {
    const state = findState(editor.state);
    if (!state?.matches.length) return;
    editor.view.dispatch(setFind(replaceAllMatches(editor.state.tr, state.matches, replacement), { query, options, current: -1 }));
  };

  const close = () => {
    onClose();
    editor.commands.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  const status = !query ? "" : !found.count ? t("studio.find.none") : found.current < 0 ? t("studio.find.total", { count: found.count }) : t("studio.find.count", { current: found.current + 1, total: found.count });

  return (
    <section role="search" aria-label={t("studio.find.title")} className="glass absolute right-4 top-4 z-30 w-80 space-y-2 rounded-xl border border-border/60 p-3 shadow-lg" onKeyDown={onKeyDown} data-testid="document-find">
      <div className="flex items-center gap-1">
        <IconButton icon={Replace} label={t("studio.find.toggleReplace")} active={showReplace} aria-expanded={showReplace} onClick={() => setShowReplace((shown) => !shown)} />
        <TextInput
          ref={findRef}
          value={query}
          aria-label={t("studio.find.find")}
          aria-describedby={statusId}
          placeholder={t("studio.find.find")}
          className="h-8 min-w-0 flex-1 text-sm"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            go(event.shiftKey ? -1 : 1);
          }}
        />
        <IconButton icon={X} label={t("studio.find.close")} shortcut="Esc" onClick={close} />
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
        <IconButton icon={ChevronUp} label={t("studio.find.previous")} shortcut="Shift+Enter" disabled={!found.count} onClick={() => go(-1)} />
        <IconButton icon={ChevronDown} label={t("studio.find.next")} shortcut="Enter" disabled={!found.count} onClick={() => go(1)} />
        <span id={statusId} role="status" aria-live="polite" className="ms-auto text-xs tabular-nums text-muted-foreground">
          {status}
        </span>
      </div>
      {showReplace ? (
        <div className="flex justify-end gap-2">
          <button type="button" className="glass-chip h-8 rounded-lg px-3 text-sm font-medium disabled:pointer-events-none disabled:opacity-40" disabled={!found.count} onClick={replaceOne}>
            {t("studio.find.replace")}
          </button>
          <button type="button" className="glass-chip h-8 rounded-lg px-3 text-sm font-medium disabled:pointer-events-none disabled:opacity-40" disabled={!found.count} onClick={replaceAll} title={`${t("studio.find.replaceAll")} (${shortcutLabel("Ctrl+Enter")})`}>
            {t("studio.find.replaceAll")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
