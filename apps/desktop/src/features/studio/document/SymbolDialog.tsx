import { useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { cn } from "@/shared/lib/cn";
import { codePointLabel, readRecentSymbols, rememberSymbol, SYMBOL_GROUP_KEYS, symbolsOf, type SymbolGroup } from "./symbols";

const COLUMNS = 10;

function SymbolGrid({ symbols, label, onPick, testId }: { symbols: string[]; label: string; onPick: (symbol: string) => void; testId: string }) {
  const [active, setActive] = useState(0);
  const cells = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.min(active, symbols.length - 1);

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const forward = getComputedStyle(event.currentTarget).direction === "rtl" ? -1 : 1;
    const steps: Record<string, number> = { ArrowLeft: -forward, ArrowRight: forward, ArrowUp: -COLUMNS, ArrowDown: COLUMNS, Home: -current, End: symbols.length - 1 - current };
    if (!(event.key in steps)) return;
    event.preventDefault();
    const next = Math.min(symbols.length - 1, Math.max(0, current + steps[event.key]));
    setActive(next);
    cells.current[next]?.focus();
  };

  return (
    <div role="group" aria-label={label} className="grid grid-cols-10 gap-1" onKeyDown={move} data-testid={testId}>
      {symbols.map((symbol, index) => (
        <button
          key={symbol}
          ref={(node) => {
            cells.current[index] = node;
          }}
          type="button"
          tabIndex={index === current ? 0 : -1}
          aria-label={`${symbol} ${codePointLabel(symbol)}`}
          title={codePointLabel(symbol)}
          onFocus={() => setActive(index)}
          onClick={() => onPick(symbol)}
          className="nav-glass flex aspect-square items-center justify-center rounded-md text-lg text-foreground hover:text-primary"
        >
          {symbol}
        </button>
      ))}
    </div>
  );
}

export function SymbolDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const { t } = useTranslation();
  const [group, setGroup] = useState<SymbolGroup>("punctuation");
  const [recent, setRecent] = useState<string[]>(readRecentSymbols);

  const pick = (symbol: string) => {
    editor.commands.insertContent(symbol);
    setRecent((current) => rememberSymbol(symbol, current));
  };

  const close = () => {
    onClose();
    editor.commands.focus();
  };

  return (
    <Dialog
      open
      onClose={close}
      title={t("studio.doc.symbols.title")}
      footer={
        <Button variant="primary" onClick={close}>
          {t("common.close")}
        </Button>
      }
    >
      <div className="space-y-4">
        {recent.length ? (
          <section className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">{t("studio.doc.symbols.recent")}</h3>
            <SymbolGrid symbols={recent} label={t("studio.doc.symbols.recent")} onPick={pick} testId="symbols-recent" />
          </section>
        ) : null}
        <div role="tablist" aria-label={t("studio.doc.symbols.groups")} className="flex flex-wrap gap-1">
          {SYMBOL_GROUP_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={key === group}
              onClick={() => setGroup(key)}
              className={cn("rounded-lg px-2.5 py-1 text-sm font-medium", key === group ? "glass-chip text-primary" : "nav-glass text-foreground/80 hover:text-foreground")}
            >
              {t(`studio.doc.symbols.groupNames.${key}`)}
            </button>
          ))}
        </div>
        <div role="tabpanel" aria-label={t(`studio.doc.symbols.groupNames.${group}`)}>
          <SymbolGrid key={group} symbols={symbolsOf(group)} label={t(`studio.doc.symbols.groupNames.${group}`)} onPick={pick} testId="symbols-grid" />
        </div>
      </div>
    </Dialog>
  );
}
