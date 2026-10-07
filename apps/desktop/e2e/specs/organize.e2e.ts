import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { $, $$, browser, expect } from "@wdio/globals";
import {
  answerDialogs,
  bootApp,
  button,
  chooseCard,
  chooseOption,
  chooseSource,
  chooseFromToolbarMenu,
  clickButton,
  clickDropArea,
  copyFixture,
  ENTER_KEY,
  field,
  fill,
  fixtures,
  openInViewer,
  openTool,
  outputPath,
  pressShortcut,
  probe,
  runPrimary,
  setSwitch,
  t,
  typeInto,
  waitForDialogsAnswered,
  waitForOutputs,
} from "../support/app.ts";

describe("organize", () => {
  before(bootApp);

  it("merges two files, one with a Turkish name", async () => {
    const first = copyFixture(fixtures().sample, "merge-first.pdf");
    const second = copyFixture(fixtures().second);
    await startMerge([first, second]);
    await expect($$(`//li[.//*[@title="${first}" or normalize-space(text())="${basename(first)}"]]`)).toBeElementsArrayOfSize({ gte: 1 });
    await expect($(`//*[normalize-space(.)="${t("tools.merge.total", { count: 5 })}"]`)).toBeDisplayed();
    const expected = await outputPath();
    await runPrimary(t("tools.merge.run"));
    const [output] = await waitForOutputs();
    expect(output).toBe(expected);
    const merged = probe(output);
    expect(merged.pageCount).toBe(5);
    expect(merged.pages?.[0].text).toContain("Sample page 1");
    expect(merged.pages?.[3].text).toContain("Second file page 1");
    expect(merged.pages?.[4].text).toContain("Second file page 2");
  });

  it("merges with a linked contents page and one bookmark per file", async () => {
    const first = copyFixture(fixtures().sample, "merge-contents.pdf");
    const second = copyFixture(fixtures().second, "merge-contents-second.pdf");
    await startMerge([first, second]);
    await chooseOption(t("tools.merge.bookmarks"), t("tools.merge.bookmarkStyles.files"));
    await expect($(`//*[normalize-space(.)="${t("tools.merge.bookmarkStyles.filesHint")}"]`)).toBeDisplayed();
    await $(`//label[.//*[normalize-space(.)="${t("tools.merge.contents.label")}"]]`).click();
    await runPrimary(t("tools.merge.run"));
    const [output] = await waitForOutputs();
    const merged = probe(output);
    expect(merged.pageCount).toBe(6);
    const contents = merged.pages?.[0];
    expect(contents?.text).toContain(t("tools.merge.contents.pageTitle"));
    expect(contents?.text).toContain("merge-contents-second");
    expect(contents?.links).toHaveLength(2);
    expect(merged.pages?.[1].text).toContain("Sample page 1");
    await $(`//label[.//*[normalize-space(.)="${t("tools.merge.contents.label")}"]]`).click();
    await chooseOption(t("tools.merge.bookmarks"), t("tools.merge.bookmarkStyles.nested"));
  });

  it("picks pages of a merged file from their thumbnails", async () => {
    const first = copyFixture(fixtures().sample, "merge-picked.pdf");
    const second = copyFixture(fixtures().second, "merge-picked-second.pdf");
    await startMerge([first, second]);
    await clickButton(t("tools.merge.choosePages", { name: basename(first) }));
    await expect($(`//button[@aria-label="${t("tools.pagePicker.page", { page: 3 })}"]//img`)).toBeDisplayed({ wait: 30000 });
    await clickButton(t("tools.pagePicker.presets.none"));
    await clickButton(t("tools.pagePicker.page", { page: 3 }));
    await clickButton(t("tools.pagePicker.page", { page: 1 }));
    await clickButton(t("tools.pagePicker.apply", { count: 2 }));
    await expect($(`input[aria-label="${t("tools.merge.ranges")}"]`)).toHaveValue("1, 3");
    await expect($(`//*[normalize-space(.)="${t("tools.merge.total", { count: 4 })}"]`)).toBeDisplayed();
    await runPrimary(t("tools.merge.run"));
    const [output] = await waitForOutputs();
    const merged = probe(output);
    expect(merged.pageCount).toBe(4);
    expect(merged.pages?.[1].text).toContain("Sample page 3");
    expect(merged.pages?.[2].text).toContain("Second file page 1");
  });

  it("rotates odd pages and extracts even pages with the rest from the quick page forms", async () => {
    const source = copyFixture(fixtures().six, "quick-pages.pdf");
    await openTool("tools.grid.rotate");
    await chooseSource(source);
    await clickButton(t("tools.pageTools.scope.odd"));
    await runPrimary(t("tools.pageTools.run.rotate", { count: 3 }));
    const [rotated] = await waitForOutputs();
    expect(probe(rotated).pages?.map((page) => page.rotation)).toEqual([90, 0, 90, 0, 90, 0]);

    await openTool("tools.grid.extractPages");
    await chooseSource(source);
    await clickButton(t("tools.pageTools.scope.even"));
    await setSwitch(t("tools.pageTools.keepRest"), true);
    await runPrimary(t("tools.pageTools.run.extract", { count: 3 }));
    const outputs = await waitForOutputs();
    expect(outputs).toHaveLength(2);
    const [picked, rest] = outputs.map((path) => probe(path));
    expect(picked.pageCount).toBe(3);
    expect(picked.pages?.[0].text).toContain("Split page 2");
    expect(picked.pages?.[2].text).toContain("Split page 6");
    expect(rest.pageCount).toBe(3);
    expect(rest.pages?.[0].text).toContain("Split page 1");
  });

  it("splits a document every two pages", async () => {
    const source = copyFixture(fixtures().six);
    await openTool("nav.split");
    await chooseSource(source);
    await chooseCard(t("tools.split.modes.every.title"));
    await fill(t("tools.split.every"), "2");
    await runPrimary(t("tools.split.run"));
    const outputs = await waitForOutputs();
    expect(outputs).toHaveLength(3);
    const parts = outputs.map((path) => probe(path));
    expect(parts.map((part) => part.pageCount)).toEqual([2, 2, 2]);
    expect(parts[0].pages?.[0].text).toContain("Split page 1");
    expect(parts[1].pages?.[0].text).toContain("Split page 3");
    expect(parts[2].pages?.[1].text).toContain("Split page 6");
  });

  it("lists a long split result by drawing only the rows in view", async () => {
    const source = copyFixture(fixtures().long, "split-many.pdf");
    await openTool("nav.split");
    await chooseSource(source);
    await chooseCard(t("tools.split.modes.every.title"));
    await fill(t("tools.split.every"), "3");
    await runPrimary(t("tools.split.run"));
    const drawn = await waitForOutputs();
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.length).toBeLessThan(134);
    const rows = "//li[@data-output]";
    expect(await $(rows).getAttribute("aria-setsize")).toBe("134");
    await browser.execute(() => {
      const list = document.querySelector("li[data-output]")?.parentElement;
      if (list) list.scrollTop = list.scrollHeight;
    });
    await expect($(`${rows}[@aria-posinset="134"]`)).toBeDisplayed({ wait: 10000 });
    const last = await $(`${rows}[@aria-posinset="134"]/span[@title]`).getAttribute("title");
    expect(probe(last as string).pages?.[0].text).toContain("Long page 400");
  });

  it("splits at cut points chosen on the page thumbnails", async () => {
    const source = copyFixture(fixtures().six, "split-cuts.pdf");
    await openTool("nav.split");
    await chooseSource(source);
    await chooseCard(t("tools.split.modes.ranges.title"));
    await clickButton(t("tools.split.cuts.open"));
    await expect($(`//button[@aria-label="${t("tools.split.cuts.addCut", { page: 5 })}"]//img`)).toBeDisplayed({ wait: 30000 });
    await clickButton(t("tools.split.cuts.addCut", { page: 3 }));
    await clickButton(t("tools.split.cuts.addCut", { page: 5 }));
    await clickButton(t("tools.split.cuts.apply", { count: 3 }));
    await expect(field(t("tools.split.ranges"))).toHaveValue("1-2; 3-4; 5-6");
    await runPrimary(t("tools.split.run"));
    const outputs = await waitForOutputs();
    expect(outputs).toHaveLength(3);
    const parts = outputs.map((path) => probe(path));
    expect(parts.map((part) => part.pageCount)).toEqual([2, 2, 2]);
    expect(parts[1].pages?.[0].text).toContain("Split page 3");
    expect(parts[2].pages?.[0].text).toContain("Split page 5");
  });

  it("splits a text PDF where a phrase appears and names the part after its line", async () => {
    const source = copyFixture(fixtures().six, "split-text.pdf");
    await openTool("nav.split");
    await chooseSource(source);
    await chooseCard(t("tools.split.modes.text.title"));
    await fill(t("tools.split.text.find"), "split page 4");
    await clickButton(t("tools.scan.split.preview.run"));
    await expect($(`//*[normalize-space(.)="${t("tools.scan.split.preview.range", { first: 4, last: 6 })} · ${t("tools.scan.split.preview.pages", { count: 3 })}"]`)).toBeDisplayed({ wait: 30000 });
    await runPrimary(t("tools.split.run"));
    const outputs = await waitForOutputs();
    expect(outputs.map((path) => basename(path))).toEqual(["split-text-1-p1-3.pdf", "split-text-2-Split page 4.pdf"]);
    const parts = outputs.map((path) => probe(path));
    expect(parts.map((part) => part.pageCount)).toEqual([3, 3]);
    expect(parts[1].pages?.[0].text).toContain("Split page 4");
  });

  it("previews a scan split by text and suggests OCR for pages without text", async () => {
    const source = copyFixture(fixtures().six, "scan-preview.pdf");
    await openTool("tools.scan.split.title");
    await chooseSource(source);
    await chooseCard(t("tools.scan.split.modes.text.title"));
    await fill(t("tools.scan.split.textPattern"), "Split page ([135])");
    await clickButton(t("tools.scan.split.preview.run"));
    await expect($(`//p[starts-with(normalize-space(.), "${t("tools.scan.split.preview.summary", { count: 3 })}")]`)).toBeDisplayed({ wait: 30000 });
    await expect($(`//*[normalize-space(.)="${t("tools.scan.split.preview.range", { first: 3, last: 4 })} · ${t("tools.scan.split.preview.pages", { count: 2 })}"]`)).toBeDisplayed();

    const scanned = copyFixture(fixtures().scanned, "scan-preview-image.pdf");
    await chooseSource(scanned);
    await clickButton(t("tools.scan.split.preview.run"));
    await expect(button(t("tools.scan.split.preview.runOcr"))).toBeDisplayed({ wait: 30000 });
  });

  it("rotates and deletes pages in the organizer and applies the result", async () => {
    const source = copyFixture(fixtures().sample, "organize.pdf");
    await openInViewer(source);
    await openTool("tools.grid.organizer");
    const tiles = $$("li[data-tile-index]");
    await expect(tiles).toBeElementsArrayOfSize(3);

    await selectOnly(0);
    await expect($('li[data-tile-index="0"]')).toHaveAttribute("aria-selected", "true");
    await clickButton(t("tools.pages.rotateRight"));
    await expect($('li[data-tile-index="0"]')).toHaveText(expect.stringContaining("90°"));

    await selectOnly(2);
    await expect($('li[data-tile-index="2"]')).toHaveAttribute("aria-selected", "true");
    await expect($('li[data-tile-index="0"]')).toHaveAttribute("aria-selected", "false");
    await clickButton(t("tools.pages.delete"));
    await expect(tiles).toBeElementsArrayOfSize(2);

    const expected = await outputPath();
    await runPrimary(t("tools.pages.apply"));
    const [output] = await waitForOutputs();
    expect(output).toBe(expected);
    await browser.waitUntil(() => existsSync(output));
    const result = probe(output);
    expect(result.pageCount).toBe(2);
    expect(result.pages?.[0].rotation).toBe(90);
    expect(result.pages?.[0].text).toContain("Sample page 1");
    expect(result.pages?.[1].rotation).toBe(0);
    expect(result.pages?.[1].text).toContain("Sample page 2");
    expect(probe(source).pageCount).toBe(3);
  });

  it("inserts a lined paper page that is saved as drawn lines", async () => {
    const source = copyFixture(fixtures().sample, "organize-paper.pdf");
    await openTool("nav.viewer");
    await openInViewer(source);
    await openTool("tools.grid.organizer");
    const tiles = $$("li[data-tile-index]");
    await expect(tiles).toBeElementsArrayOfSize(3);

    await selectOnly(0);
    await browser.keys(["b"]);
    await chooseOption(t("tools.pages.paper.label"), t("tools.pages.paper.lined"));
    await expect($(`//*[@role="dialog"]//*[local-name()="svg"]`)).toBeDisplayed();
    await clickButton(t("tools.pages.insert"));
    await expect(tiles).toBeElementsArrayOfSize(4);
    await expect($('li[data-tile-index="1"]')).toHaveText(expect.stringContaining(t("tools.pages.paper.lined")));

    await runPrimary(t("tools.pages.apply"));
    const [output] = await waitForOutputs();
    await browser.waitUntil(() => existsSync(output));
    const result = probe(output);
    expect(result.pageCount).toBe(4);
    expect(result.pages?.[1].drawings).toBeGreaterThan(0);
    expect(result.pages?.[1].text.trim()).toBe("");
    expect(result.pages?.[2].text).toContain("Sample page 2");
  });

  it("finds inserted blank pages, straightens a page and selects by dragging", async () => {
    const source = copyFixture(fixtures().sample, "organize-select.pdf");
    await openTool("nav.viewer");
    await openInViewer(source);
    await openTool("tools.grid.organizer");
    const tiles = $$("li[data-tile-index]");
    await expect(tiles).toBeElementsArrayOfSize(3);

    await selectOnly(0);
    await expect(button(t("tools.pages.rotateRight"))).toHaveAttribute("aria-keyshortcuts", "R");
    await browser.keys(["b"]);
    const insert = button(t("tools.pages.insert"));
    await insert.waitForClickable();
    await insert.click();
    await expect(tiles).toBeElementsArrayOfSize(4);

    await chooseFromToolbarMenu(t("tools.pages.groups.select"), "select-blank");
    await browser.waitUntil(async () => (await $$("li[aria-selected='true']").length) === 1, { timeout: 60000 });
    await expect($('li[data-tile-index="1"]')).toHaveAttribute("aria-selected", "true");

    await selectOnly(0);
    await browser.keys(["r"]);
    await expect($('li[data-tile-index="0"]')).toHaveText(expect.stringContaining("90°"));
    await chooseFromToolbarMenu(t("tools.pages.groups.edit"), "auto-rotate");
    await browser.waitUntil(async () => !(await $('li[data-tile-index="0"]').getText()).includes("90°"), { timeout: 60000 });

    const container = await $("ol[role='listbox']").parentElement();
    const box = await browser.execute((element) => {
      const rect = (element as HTMLElement).getBoundingClientRect();
      return { x: Math.round(rect.left + 4), y: Math.round(rect.top + 4) };
    }, container);
    const target = await browser.execute(() => {
      const rect = document.querySelector('li[data-tile-index="1"]')!.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    });
    await browser.performActions([
      {
        type: "pointer",
        id: "mouse",
        parameters: { pointerType: "mouse" },
        actions: [
          { type: "pointerMove", origin: "viewport", x: box.x, y: box.y },
          { type: "pointerDown", button: 0 },
          { type: "pointerMove", origin: "viewport", x: box.x + 20, y: box.y + 20, duration: 50 },
          { type: "pointerMove", origin: "viewport", x: target.x, y: target.y, duration: 150 },
          { type: "pointerUp", button: 0 },
        ],
      },
    ]);
    await browser.releaseActions();
    await expect($('li[data-tile-index="0"]')).toHaveAttribute("aria-selected", "true");
    await expect($('li[data-tile-index="1"]')).toHaveAttribute("aria-selected", "true");
    await expect($('li[data-tile-index="2"]')).toHaveAttribute("aria-selected", "false");
    await expect($('li[data-tile-index="3"]')).toHaveAttribute("aria-selected", "false");

    await clickButton(t("tools.pages.selectNone"));
    await expect($(`//*[normalize-space(.)="${t("tools.pages.selectHint")}"]`)).toBeDisplayed();
    await $(`button[aria-label="${t("tools.pages.selectPage", { page: 2 })}"]`).click();
    await $(`button[aria-label="${t("tools.pages.selectPage", { page: 4 })}"]`).click();
    await expect($('li[data-tile-index="1"]')).toHaveAttribute("aria-selected", "true");
    await expect($('li[data-tile-index="3"]')).toHaveAttribute("aria-selected", "true");
    await expect($('li[data-tile-index="0"]')).toHaveAttribute("aria-selected", "false");
    await expect($(`//*[@role="status"][normalize-space(.)="${t("tools.pages.selectedCount", { count: 2 })}"]`)).toBeDisplayed();

    await clickButton(t("tools.pages.multiSelectMode"));
    await $('li[data-tile-index="0"]').click();
    await expect($('li[data-tile-index="0"]')).toHaveAttribute("aria-selected", "true");
    await expect($('li[data-tile-index="3"]')).toHaveAttribute("aria-selected", "true");
    await clickButton(t("tools.pages.multiSelectMode"));
  });

  it("splits at chapters, previews, finds copies, labels pages and arranges them for two-sided printing", async () => {
    const source = copyFixture(fixtures().chapters, "organize-chapters.pdf");
    const tile = (index: number) => $(`li[data-tile-index="${index}"]`);
    const selectedCount = async () => (await $$("li[aria-selected='true']")).length;
    const menuItem = (id: string) => $(`[role="menuitem"][data-menu-id="${id}"]`);
    await openTool("nav.viewer");
    await openInViewer(source);
    await openTool("tools.grid.organizer");
    await expect($$("li[data-tile-index]")).toBeElementsArrayOfSize(6);

    await chooseFromToolbarMenu(t("tools.pages.groups.split"), "cut-chapters");
    await expect(button(t("tools.pages.splitParts", { count: 3 }))).toBeDisplayed({ wait: 60000 });

    await pressShortcut("g");
    await fill(t("tools.pages.range.label", { total: 6 }), "2-3, 6");
    await browser.keys(ENTER_KEY);
    await browser.waitUntil(async () => (await selectedCount()) === 3);
    await expect(tile(1)).toHaveAttribute("aria-selected", "true");
    await expect(tile(5)).toHaveAttribute("aria-selected", "true");

    await tile(0).doubleClick();
    await expect($('[data-testid="page-preview"]')).toBeDisplayed();
    await expect(tile(0)).toHaveAttribute("aria-selected", "true");
    await browser.keys(ARROW_RIGHT_KEY);
    await expect(tile(1)).toHaveAttribute("aria-selected", "false");
    await browser.keys(ENTER_KEY);
    await expect(tile(1)).toHaveAttribute("aria-selected", "true");
    await expect($(`[data-testid="page-preview"] [role="checkbox"][aria-checked="true"]`)).toBeDisplayed();
    await browser.keys(ENTER_KEY);
    await expect(tile(1)).toHaveAttribute("aria-selected", "false");
    await expect(tile(3)).toHaveAttribute("aria-selected", "false");
    await browser.keys([SHIFT_KEY, ARROW_RIGHT_KEY, ARROW_RIGHT_KEY]);
    await browser.keys([SHIFT_KEY]);
    await expect(tile(3)).toHaveAttribute("aria-selected", "true");
    await expect(tile(0)).toHaveAttribute("aria-selected", "true");
    await browser.keys(SPACE_KEY);
    await expect($('[data-testid="page-preview"]')).not.toBeDisplayed();
    await expect(tile(5)).toHaveAttribute("aria-selected", "false");

    await tile(0).click({ button: "right" });
    await menuItem("duplicate").click();
    await expect($$("li[data-tile-index]")).toBeElementsArrayOfSize(7);
    await selectOnly(3);
    await chooseFromToolbarMenu(t("tools.pages.groups.select"), "select-duplicates");
    await browser.waitUntil(async () => (await selectedCount()) === 1 && (await tile(1).getAttribute("aria-selected")) === "true", { timeout: 60000 });
    await browser.keys(DELETE_KEY);
    await expect($$("li[data-tile-index]")).toBeElementsArrayOfSize(6);

    const setLabel = async (index: number, preset: string) => {
      await tile(index).click({ button: "right" });
      await menuItem("label").click();
      await clickButton(t(`tools.pages.labels.preset.${preset}`));
      await clickButton(t("tools.pages.labels.apply"));
    };
    await setLabel(0, "cover");
    await setLabel(1, "roman");
    await setLabel(2, "fromOne");
    await expect(tile(3)).toHaveText(expect.stringContaining("2"));

    const expected = await outputPath();
    await runPrimary(t("tools.pages.apply"));
    const [output] = await waitForOutputs();
    expect(output).toBe(expected);
    await browser.waitUntil(() => existsSync(output));
    expect(probe(output).pages?.map((page) => page.label)).toEqual([t("tools.pages.labels.coverText"), "i", "1", "2", "3", "4"]);

    await chooseFromToolbarMenu(t("tools.pages.groups.edit"), "duplex");
    await clickButton(t("tools.pages.duplex.apply"));
    await expect(button(t("tools.pages.splitParts", { count: 2 }))).toBeDisplayed();
    await expect(tile(1)).toHaveText(expect.stringContaining("← 3"));
    await expect(tile(3)).toHaveText(expect.stringContaining("← 6"));
  });

  it("copies a page into another document, pastes it after the selection and undoes the paste", async () => {
    const first = copyFixture(fixtures().sample, "clip-from.pdf");
    const second = copyFixture(fixtures().sample, "clip-into.pdf");
    await openTool("nav.viewer");
    await openInViewer(first);
    await openTool("tools.grid.organizer");
    const tiles = $$("li[data-tile-index]");
    await expect(tiles).toBeElementsArrayOfSize(3);
    await selectOnly(2);
    await pressShortcut("c");

    await openTool("nav.viewer");
    await openInViewer(second);
    await openTool("tools.grid.organizer");
    await expect(tiles).toBeElementsArrayOfSize(3);
    await selectOnly(0);
    await pressShortcut("v");
    await expect(tiles).toBeElementsArrayOfSize(4);
    await pressShortcut("z");
    await expect(tiles).toBeElementsArrayOfSize(3);
    await pressShortcut("y");
    await expect(tiles).toBeElementsArrayOfSize(4);
    await expect($('li[data-tile-index="1"]')).toHaveText(expect.stringContaining("clip-from.pdf"));

    await runPrimary(t("tools.pages.apply"));
    const [output] = await waitForOutputs();
    await browser.waitUntil(() => existsSync(output));
    const result = probe(output);
    expect(result.pageCount).toBe(4);
    expect(result.pages?.[1].text).toContain("Sample page 3");
    expect(result.pages?.[2].text).toContain("Sample page 2");
  });

  it("moves pages from the keyboard and shrinks a Shift selection back", async () => {
    const source = copyFixture(fixtures().sample, "organize-keyboard.pdf");
    await openTool("nav.viewer");
    await openInViewer(source);
    await openTool("tools.grid.organizer");
    await expect($$("li[data-tile-index]")).toBeElementsArrayOfSize(3);

    await selectOnly(0);
    await browser.keys([SHIFT_KEY, ARROW_RIGHT_KEY]);
    await browser.keys([SHIFT_KEY]);
    await expect($('li[data-tile-index="1"]')).toHaveAttribute("aria-selected", "true");
    await browser.keys([SHIFT_KEY, ARROW_LEFT_KEY]);
    await browser.keys([SHIFT_KEY]);
    await expect($('li[data-tile-index="1"]')).toHaveAttribute("aria-selected", "false");
    await expect($('li[data-tile-index="0"]')).toHaveAttribute("aria-selected", "true");

    await browser.keys([ALT_KEY, ARROW_RIGHT_KEY]);
    await browser.keys([ALT_KEY]);
    await expect($('li[data-tile-index="1"]')).toHaveText(expect.stringContaining("← 1"));
    await expect($('li[data-tile-index="1"]')).toHaveAttribute("aria-selected", "true");

    await selectOnly(2);
    await browser.keys(["m"]);
    await expect($(`//*[@role="dialog"]//*[normalize-space(.)="${t("tools.pages.move.title")}"]`)).toBeDisplayed();
    await browser.keys(["1"]);
    await browser.keys(ENTER_KEY);
    await expect($('li[data-tile-index="0"]')).toHaveText(expect.stringContaining("← 3"));

    await runPrimary(t("tools.pages.apply"));
    const [output] = await waitForOutputs();
    await browser.waitUntil(() => existsSync(output));
    const result = probe(output);
    expect(result.pages?.[0].text).toContain("Sample page 3");
    expect(result.pages?.[1].text).toContain("Sample page 2");
    expect(result.pages?.[2].text).toContain("Sample page 1");
  });

  it("draws only the pages in view of a long document and still edits all of it", async () => {
    const source = copyFixture(fixtures().long, "organize-long.pdf");
    await openTool("nav.viewer");
    await openInViewer(source);
    await openTool("tools.grid.organizer");
    const first = $('li[data-tile-index="0"]');
    await expect(first).toHaveAttribute("aria-setsize", "400");
    expect(await $$("li[data-tile-index]").length).toBeLessThan(200);

    await first.click();
    await browser.keys([SHIFT_KEY, END_KEY]);
    await browser.keys([SHIFT_KEY]);
    await expect($(`//*[@role="status"][normalize-space(.)="${t("tools.pages.selectedCount", { count: 400 })}"]`)).toBeDisplayed();
    await expect($('li[data-tile-index="399"]')).toHaveAttribute("aria-selected", "true");
    await expect($('li[data-tile-index="0"]')).not.toBeExisting();

    await browser.keys([END_KEY]);
    await expect($(`//*[@role="status"][normalize-space(.)="${t("tools.pages.selectedCount", { count: 1 })}"]`)).toBeDisplayed();
    await browser.keys([DELETE_KEY]);
    await expect($('li[data-tile-index="398"]')).toHaveAttribute("aria-setsize", "399");

    const columns = await browser.execute(() => getComputedStyle(document.querySelector("ol[role='listbox']")!).gridTemplateColumns.split(" ").length);
    const lastRowStart = 398 - (398 % columns);
    const target = lastRowStart < 398 ? lastRowStart : 398 - columns;
    const points = await browser.execute(
      (from, to) => {
        const dragged = document.querySelector(`li[data-tile-index="${from}"]`)!.getBoundingClientRect();
        const onto = document.querySelector(`li[data-tile-index="${to}"]`)!.getBoundingClientRect();
        return {
          from: { x: Math.round(dragged.left + dragged.width / 2), y: Math.round(dragged.top + dragged.height / 2) },
          to: { x: Math.round(onto.left + onto.width * 0.2), y: Math.round(onto.top + onto.height / 2) },
        };
      },
      398,
      target,
    );
    await browser.performActions([
      {
        type: "pointer",
        id: "mouse",
        parameters: { pointerType: "mouse" },
        actions: [
          { type: "pointerMove", origin: "viewport", x: points.from.x, y: points.from.y },
          { type: "pointerDown", button: 0 },
          { type: "pointerMove", origin: "viewport", x: points.from.x - 15, y: points.from.y, duration: 50 },
          { type: "pointerMove", origin: "viewport", x: points.to.x, y: points.to.y, duration: 200 },
          { type: "pointerUp", button: 0 },
        ],
      },
    ]);
    await browser.releaseActions();
    await expect($(`li[data-tile-index="${target}"]`)).toHaveText(expect.stringContaining("← 399"));

    await runPrimary(t("tools.pages.apply"));
    const [output] = await waitForOutputs();
    await browser.waitUntil(() => existsSync(output));
    const result = probe(output);
    expect(result.pageCount).toBe(399);
    expect(result.pages?.[target].text).toContain("Long page 399");
    expect(result.pages?.[398].text).toContain("Long page 398");
  });

  it("renames into a folder, skips a clashing name edited in the table and undoes the rename", async () => {
    const first = copyFixture(fixtures().sample, "rename-first.pdf");
    const second = copyFixture(fixtures().second, "rename-second.pdf");
    const folder = join(dirname(first), "renamed");
    await openTool("nav.rename");
    answerDialogs([first, second]);
    await clickDropArea(t("tools.batch.dropTitle"));
    await waitForDialogsAnswered();
    await fill(t("tools.rename.pattern"), "renamed/{name}");
    const secondName = $(`input[aria-label="${t("tools.rename.newNameFor", { name: basename(second) })}"]`);
    await browser.waitUntil(async () => (await secondName.isExisting()) && (await secondName.getValue()) === "renamed/rename-second", { timeout: 60000, timeoutMsg: "the preview never showed the folder name" });
    await typeInto(secondName, "renamed/rename-first");
    await expect($(`//*[normalize-space(.)="${t("tools.rename.conflictCount", { count: 1 })}"]`)).toBeDisplayed({ wait: 30000 });
    await chooseOption(t("tools.rename.policy.label"), t("tools.rename.policy.skip"));
    await expect($(`//*[normalize-space(.)="${t("tools.rename.conflicts.skip")}"]`)).toBeDisplayed();

    await runPrimary(t("tools.rename.run.rename", { count: 2 }));
    const outputs = await waitForOutputs();
    expect(outputs).toEqual([join(folder, "rename-first.pdf")]);
    expect(existsSync(first)).toBe(false);
    expect(existsSync(second)).toBe(true);
    await expect($(`//*[normalize-space(.)="${t("tools.rename.failure.exists", { name: "rename-first.pdf" })}"]`)).toBeDisplayed();

    await expect($(`//*[normalize-space(.)="${t("tools.rename.undo.available", { count: 1 })}"]`)).toBeDisplayed();
    await clickButton(t("tools.rename.undo.run"));
    await expect($(`//*[normalize-space(.)="${t("tools.rename.undo.done", { count: 1 })}"]`)).toBeDisplayed({ wait: 30000 });
    expect(existsSync(first)).toBe(true);
    expect(existsSync(folder)).toBe(false);
  });
});

async function selectOnly(index: number) {
  await browser.keys(ESCAPE_KEY);
  await $(`li[data-tile-index="${index}"] button[role="checkbox"]`).click();
}

async function startMerge(paths: string[]) {
  await openTool("nav.merge");
  const clear = button(t("tools.batch.clear"));
  if (await clear.isExisting()) await clear.click();
  answerDialogs(paths);
  await clickDropArea(t("tools.batch.dropTitle"));
  await waitForDialogsAnswered();
}

const SPACE_KEY = String.fromCharCode(0xe00d);
const ESCAPE_KEY = String.fromCharCode(0xe00c);
const ARROW_RIGHT_KEY = String.fromCharCode(0xe014);
const DELETE_KEY = String.fromCharCode(0xe017);
const SHIFT_KEY = String.fromCharCode(0xe008);
const END_KEY = String.fromCharCode(0xe010);
const ALT_KEY = String.fromCharCode(0xe00a);
const ARROW_LEFT_KEY = String.fromCharCode(0xe012);