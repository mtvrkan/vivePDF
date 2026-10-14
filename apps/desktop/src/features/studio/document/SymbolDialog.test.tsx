import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import { ready, setLocale } from "@/app/i18n";
import { storeCitationSource } from "./citationSource";
import { documentExtensions } from "./extensions";
import { SymbolDialog } from "./SymbolDialog";
import { readRecentSymbols, rememberSymbol, RECENT_LIMIT, SYMBOL_GROUP_KEYS, symbolsOf } from "./symbols";

const TERMS = { and: "and", etAl: "et al.", page: "p.", pages: "pp.", noDate: "n.d.", in: "In", editor: "Ed.", editors: "Eds.", editedBy: "edited by", edition: "{ord} ed.", volume: "vol.", issue: "no.", doctoral: "Doctoral dissertation", masters: "Master's thesis", thesis: "Thesis", report: "Report No.", available: "Available" };

let editor: Editor | null = null;

function mount(content = "<p>ab</p>") {
  editor = new Editor({ extensions: documentExtensions("", storeCitationSource(TERMS, "en", "References", "")), content });
  editor.commands.setTextSelection(2);
  let closed = 0;
  render(<SymbolDialog editor={editor} onClose={() => (closed += 1)} />);
  return { current: editor, closed: () => closed };
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  editor?.destroy();
  editor = null;
});

describe("SymbolDialog", () => {
  it("inserts the picked symbol at the cursor and keeps the dialog open", () => {
    const { current, closed } = mount();

    fireEvent.click(screen.getByRole("tab", { name: "Currency" }));
    fireEvent.click(screen.getByRole("button", { name: "₺ U+20BA" }));
    fireEvent.click(screen.getByRole("button", { name: "€ U+20AC" }));

    expect(current.getText()).toBe("a₺€b");
    expect(closed()).toBe(0);
    expect(within(screen.getByTestId("symbols-recent")).getAllByRole("button").map((button) => button.textContent)).toEqual(["€", "₺"]);
  });

  it("moves between symbols with the arrow keys and keeps one tab stop", () => {
    mount();
    const grid = screen.getByTestId("symbols-grid");
    const cells = within(grid).getAllByRole("button");
    cells[0].focus();

    fireEvent.keyDown(grid, { key: "ArrowRight" });
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    const reached = document.activeElement;
    fireEvent.keyDown(grid, { key: "End" });

    expect(reached).toBe(cells[11]);
    expect(document.activeElement).toBe(cells[cells.length - 1]);
    expect(cells.filter((cell) => cell.tabIndex === 0)).toHaveLength(1);
  });

  it("closes from the footer button", () => {
    const { closed } = mount();

    const buttons = screen.getAllByRole("button", { name: "Close" });
    fireEvent.click(buttons[buttons.length - 1]);

    expect(closed()).toBe(1);
  });
});

describe("symbol lists", () => {
  it("keeps every group free of repeats", () => {
    const repeated = SYMBOL_GROUP_KEYS.filter((group) => new Set(symbolsOf(group)).size !== symbolsOf(group).length);

    expect(repeated).toEqual([]);
  });

  it("remembers the most recent symbols first, without repeats and up to the limit", () => {
    let recent: string[] = [];
    for (const symbol of [...symbolsOf("greek").slice(0, RECENT_LIMIT + 2), "α"]) recent = rememberSymbol(symbol, recent);

    expect(recent).toHaveLength(RECENT_LIMIT);
    expect(recent[0]).toBe("α");
    expect(readRecentSymbols()).toEqual(recent);
  });

  it("ignores stored text that is not one of its symbols", () => {
    localStorage.setItem("vivepdf.studio.recentSymbols", JSON.stringify(["<b>", "€", 3]));

    const recent = readRecentSymbols();

    expect(recent).toEqual(["€"]);
  });
});
