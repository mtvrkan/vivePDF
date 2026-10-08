import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $, $$, browser, expect } from "@wdio/globals";
import {
  ENTER_KEY,
  answerDialogs,
  bootApp,
  chooseFromToolbarMenu,
  clickButton,
  closeAllDocuments,
  copyFixture,
  fixtures,
  openInViewer,
  openTool,
  pressShortcut,
  t,
  typeInto,
  waitForDialogsAnswered,
  workDir,
} from "../support/app.ts";
import { APP_IDENTIFIER } from "../support/paths.ts";

const LARGE_DIR = process.env.VIVEPDF_E2E_LARGE_DIR;
const DOCUMENTS = [
  { name: "tez-800-sayfa.pdf", pages: 800, firstPageBudget: 8000, lastPageBudget: 8000, viewCopies: 0, heapBudgetMb: null },
  { name: "taranmis-kitap.pdf", pages: 240, firstPageBudget: 15000, lastPageBudget: 10000, viewCopies: 1, heapBudgetMb: 150 },
];
const VIEW_SNAPSHOTS = join(process.env.LOCALAPPDATA ?? "", APP_IDENTIFIER, "view-snapshots");
const suite = LARGE_DIR ? describe : describe.skip;

type Timing = { name: string; openMs: number; firstPageMs: number; lastPageMs: number; heapMb: number | null };

async function scrollerState() {
  return browser.execute(() => {
    const page = document.querySelector<HTMLElement>("[data-page-index]");
    let scroller = page?.parentElement ?? null;
    while (scroller && scroller.scrollHeight <= scroller.clientHeight) scroller = scroller.parentElement;
    const drawn = Array.from(document.querySelectorAll<HTMLElement>("[data-page-index]")).map((node) => Number(node.dataset.pageIndex) + 1);
    return { scrollTop: scroller?.scrollTop ?? null, scrollHeight: scroller?.scrollHeight ?? null, drawn: [drawn[0], drawn[drawn.length - 1]] };
  });
}

async function renderedPage(pageIndex: number, timeout: number) {
  const page = $(`[data-page-index="${pageIndex}"]`);
  try {
    await browser.waitUntil(async () => (await page.isExisting()) && (await page.$$("img, canvas").length) > 0, { timeout, interval: 50 });
  } catch {
    throw new Error(`page ${pageIndex + 1} was not drawn within ${timeout} ms: ${JSON.stringify(await scrollerState())}`);
  }
}

function viewCopies(): number {
  return existsSync(VIEW_SNAPSHOTS) ? readdirSync(VIEW_SNAPSHOTS).length : 0;
}

const LOCK_TURNED_COPY = `
import sys, pymupdf
document = pymupdf.open(sys.argv[1])
document[0].set_rotation(90)
document.save(sys.argv[2], encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="secret", owner_pw="owner-secret")
`;

async function pageWidthOverHeight(index: number): Promise<number> {
  await renderedPage(index, 30000);
  return browser.execute((pageIndex: number) => {
    const rect = (document.querySelector(`[data-page-index="${pageIndex}"]`) as HTMLElement).getBoundingClientRect();
    return rect.width / rect.height;
  }, index);
}

async function typePassword(text: string) {
  const input = $('input[type="password"]');
  await input.waitForEnabled({ timeout: 30000 });
  await input.clearValue();
  await typeInto(input, text);
  await clickButton(t("password.open"));
}

async function chooseEmptySource(path: string) {
  answerDialogs(path);
  const choose = t("tools.chooseSource");
  const trigger = $(`//button[normalize-space(.)="${choose}" or span[normalize-space(.)="${choose}"]]`);
  await trigger.waitForClickable();
  await trigger.click();
  await waitForDialogsAnswered();
  await $(`//span[@title="${path}"]`).waitForDisplayed({ timeout: 60000 });
}

async function drawnFirstPages(): Promise<number> {
  return browser.execute(
    () => Array.from(document.querySelectorAll<HTMLElement>('[data-page-index="0"]')).filter((page) => page.querySelector("img, canvas") !== null).length,
  );
}

async function heapMegabytes(): Promise<number | null> {
  return browser.execute(() => {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    return memory ? Math.round(memory.usedJSHeapSize / 1048576) : null;
  });
}

suite("large documents", () => {
  const timings: Timing[] = [];

  before(bootApp);

  after(() => {
    writeFileSync(join(workDir(), "large-timings.json"), JSON.stringify(timings, null, 2));
    console.log(JSON.stringify(timings));
  });

  for (const document of DOCUMENTS) {
    it(`opens ${document.name}, draws its first page and jumps to its last page in budget`, async function () {
      const source = join(LARGE_DIR as string, document.name);
      if (!existsSync(source)) this.skip();
      const path = copyFixture(source);

      const opening = Date.now();
      await openInViewer(path);
      const openMs = Date.now() - opening;
      await renderedPage(0, document.firstPageBudget);
      const firstPageMs = Date.now() - opening;

      await expect($(`[data-testid="page-count"]`)).toHaveText(String(document.pages));
      const jumping = Date.now();
      await typeInto($(`input[aria-label="${t("viewer.pageNumber")}"]`), String(document.pages));
      await browser.keys(ENTER_KEY);
      await renderedPage(document.pages - 1, document.lastPageBudget);
      const lastPageMs = Date.now() - jumping;

      const heapMb = await heapMegabytes();
      timings.push({ name: document.name, openMs, firstPageMs, lastPageMs, heapMb });
      expect(viewCopies()).toBe(document.viewCopies);
      if (document.heapBudgetMb !== null && heapMb !== null) expect(heapMb).toBeLessThan(document.heapBudgetMb);
      await closeAllDocuments();
      await browser.waitUntil(async () => viewCopies() === 0, { timeout: 10000, timeoutMsg: "the view copy outlived its tab" });
    });
  }

  it("opens a locked large scan in pieces after a wrong password and keeps its turned page turned", async function () {
    const source = join(LARGE_DIR as string, "taranmis-kitap.pdf");
    if (!existsSync(source)) this.skip();
    const path = join(workDir(), "kilitli-tarama.pdf");
    execFileSync(process.env.VIVEPDF_E2E_PYTHON as string, ["-c", LOCK_TURNED_COPY, source, path]);

    answerDialogs(path);
    await pressShortcut("o");
    await waitForDialogsAnswered();
    await typePassword("wrong");
    await $('input[type="password"][aria-invalid="true"]').waitForDisplayed({ timeout: 30000 });
    await typePassword("secret");
    await expect($(`[data-testid="page-count"]`)).toHaveText("240", { wait: 60000 });

    expect(viewCopies()).toBe(1);
    expect(await pageWidthOverHeight(0)).toBeGreaterThan(1);
    expect(await pageWidthOverHeight(1)).toBeLessThan(1);
    await closeAllDocuments();
    await browser.waitUntil(async () => viewCopies() === 0, { timeout: 10000, timeoutMsg: "the view copy outlived its tab" });
  });

  it("compares two large scans side by side in pieces and lets their copies go when the view closes", async function () {
    const source = join(LARGE_DIR as string, "taranmis-kitap.pdf");
    if (!existsSync(source)) this.skip();
    const first = copyFixture(source, "karsilastir-a.pdf");
    const second = copyFixture(source, "karsilastir-b.pdf");

    await openTool("nav.compare");
    await $(`//*[@role="tab"][normalize-space(.)="${t("tools.compare.sideBySide.tabs.sideBySide")}"]`).click();
    await chooseEmptySource(first);
    await chooseEmptySource(second);
    await browser.waitUntil(async () => (await drawnFirstPages()) === 2, { timeout: 60000, timeoutMsg: "both large scans were not drawn side by side" });

    expect(viewCopies()).toBe(2);
    const heapMb = await heapMegabytes();
    if (heapMb !== null) expect(heapMb).toBeLessThan(150);
    await $(`//*[@role="tab"][normalize-space(.)="${t("tools.compare.sideBySide.tabs.diff")}"]`).click();
    await browser.waitUntil(async () => viewCopies() === 0, { timeout: 10000, timeoutMsg: "the side-by-side copies outlived the view" });
  });

  it("inserts pages of a large scan in the organizer from pieces and lets the copy go when the document closes", async function () {
    const scan = join(LARGE_DIR as string, "taranmis-kitap.pdf");
    if (!existsSync(scan)) this.skip();
    const inserted = copyFixture(scan, "eklenecek-tarama.pdf");
    await openInViewer(copyFixture(fixtures().sample, "duzenlenecek.pdf"));
    await openTool("tools.grid.organizer");
    await expect($$("li[data-tile-index]")).toBeElementsArrayOfSize(3);

    answerDialogs(inserted);
    await chooseFromToolbarMenu(t("tools.pages.groups.insert"), "insert-pdf");
    await waitForDialogsAnswered();
    await typeInto($(`//*[@role="dialog"]//input[not(@type="password")]`), "239-240");
    await clickButton(t("tools.pages.insertCount", { count: 2 }));
    await expect($$("li[data-tile-index]")).toBeElementsArrayOfSize(5);
    await browser.waitUntil(
      async () =>
        (await browser.execute(() => Array.from(document.querySelectorAll("li[data-tile-index]")).every((tile) => tile.querySelector("img, canvas") !== null))) &&
        viewCopies() === 1,
      { timeout: 60000, timeoutMsg: "the inserted scan pages were not drawn from a view copy" },
    );

    await closeAllDocuments();
    await browser.waitUntil(async () => viewCopies() === 0, { timeout: 10000, timeoutMsg: "the inserted scan copy outlived its document" });
  });
});
