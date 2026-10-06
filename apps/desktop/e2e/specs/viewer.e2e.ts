import { readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $, $$, browser, expect } from "@wdio/globals";
import { ENTER_KEY, answerDialogs, bootApp, button, clickButton, closeAllDocuments, copyFixture, fixtures, openInViewer, pressShortcut, probe, t, typeInto, waitForDialogsAnswered, waitForFile, workDir } from "../support/app.ts";

const ESCAPE_KEY = String.fromCharCode(0xe00c);
const SHIFT_KEY = String.fromCharCode(0xe008);
const F5_KEY = String.fromCharCode(0xe035);
const ALT_KEY = String.fromCharCode(0xe00a);
const LEFT_KEY = String.fromCharCode(0xe012);
const RIGHT_KEY = String.fromCharCode(0xe014);
const DOWN_KEY = String.fromCharCode(0xe015);

async function pagePoint(pageIndex: number, x: number, y: number) {
  const page = $(`[data-page-index="${pageIndex}"]`);
  await page.waitForDisplayed();
  await browser.waitUntil(async () => (await page.$$("img, canvas").length) > 0, { timeoutMsg: `page ${pageIndex + 1} never rendered` });
  const box = await browser.execute((index) => {
    const rect = (document.querySelector(`[data-page-index="${index}"]`) as HTMLElement).getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width };
  }, pageIndex);
  const scale = box.width / 595;
  return { origin: "viewport" as const, x: Math.round(box.left + x * scale), y: Math.round(box.top + y * scale) };
}

async function pressAlt(key: string) {
  await browser.keys([ALT_KEY, key]);
  await browser.keys([ALT_KEY]);
}

async function centredPage(): Promise<number> {
  return browser.execute(() => {
    const middle = window.innerHeight / 2;
    const pages = Array.from(document.querySelectorAll<HTMLElement>(".immersive-view [data-page-index]"));
    const hit = pages.find((page) => {
      const rect = page.getBoundingClientRect();
      return rect.top <= middle && rect.bottom >= middle;
    });
    return hit ? Number(hit.dataset.pageIndex) : -1;
  });
}

describe("viewer", () => {
  before(bootApp);

  it("opens a PDF and moves between pages", async () => {
    const path = copyFixture(fixtures().sample);
    await openInViewer(path);
    const pageInput = $(`input[aria-label="${t("viewer.pageNumber")}"]`);
    await expect($(`//span[normalize-space(.)="/ 3"]`)).toBeDisplayed();
    await expect(pageInput).toHaveValue("1");

    await clickButton(t("viewer.nextPage"));
    await expect(pageInput).toHaveValue("2");

    await typeInto(pageInput, "3");
    await browser.keys(ENTER_KEY);
    await expect(pageInput).toHaveValue("3");
    await expect($(`button[aria-label="${t("viewer.nextPage")}"]`)).toBeDisabled();

    await clickButton(t("viewer.previousPage"));
    await expect(pageInput).toHaveValue("2");
  });

  it("highlights text and saves a copy with the annotation", async () => {
    const path = copyFixture(fixtures().sample, "annotate.pdf");
    await openInViewer(path);
    await clickButton(t("viewer.annotate"));
    await clickButton(t("annotate.highlight"));
    await expect($(`button[aria-label="${t("annotate.highlight")}"]`)).toHaveAttribute("aria-pressed", "true");

    const page = $('[data-page-index="0"]');
    await page.waitForDisplayed();
    await browser.waitUntil(async () => (await page.$$("img, canvas").length) > 0, { timeoutMsg: "page 1 never rendered" });
    const box = await browser.execute(() => {
      const rect = (document.querySelector('[data-page-index="0"]') as HTMLElement).getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width };
    });
    const scale = box.width / 595;
    const at = (x: number) => ({ origin: "viewport" as const, x: Math.round(box.left + x * scale), y: Math.round(box.top + 84 * scale) });
    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move(at(66))
      .down()
      .move({ ...at(135), duration: 150 })
      .move({ ...at(200), duration: 150 })
      .up()
      .perform();

    const output = join(workDir(), "annotated.pdf");
    answerDialogs(output);
    await clickButton(t("annotate.saveAs"));
    await waitForDialogsAnswered();
    await waitForFile(output);
    await browser.waitUntil(() => (probe(output).pages?.[0].annotations ?? []).includes("Highlight"), {
      timeout: 30000,
      timeoutMsg: "saved copy has no highlight on page 1",
    });
    const saved = probe(output);
    expect(saved.pageCount).toBe(3);
    expect(saved.pages?.[1].annotations).toEqual([]);
    expect(probe(path).pages?.[0].annotations).toEqual([]);
  });

  it("starts the presentation from the first page on F5 and from the current page on Shift F5", async () => {
    const path = copyFixture(fixtures().six, "present.pdf");
    await openInViewer(path);
    const pageInput = $(`input[aria-label="${t("viewer.pageNumber")}"]`);
    await typeInto(pageInput, "4");
    await browser.keys(ENTER_KEY);
    await expect(pageInput).toHaveValue("4");
    await $('[data-page-index="3"]').click();

    await browser.keys(F5_KEY);
    await $(".immersive-view").waitForDisplayed({ timeout: 20000 });
    await browser.waitUntil(async () => (await centredPage()) === 0, { timeout: 20000, timeoutMsg: "F5 did not start on the first page" });
    await browser.keys(ESCAPE_KEY);
    await $(".immersive-view").waitForDisplayed({ reverse: true, timeout: 20000 });

    await typeInto(pageInput, "4");
    await browser.keys(ENTER_KEY);
    await expect(pageInput).toHaveValue("4");
    await $('[data-page-index="3"]').click();
    await browser.keys([SHIFT_KEY, F5_KEY]);
    await browser.keys([SHIFT_KEY]);
    await $(".immersive-view").waitForDisplayed({ timeout: 20000 });
    await browser.waitUntil(async () => (await centredPage()) === 3, { timeout: 20000, timeoutMsg: "Shift F5 did not start on the current page" });
    await browser.keys(ESCAPE_KEY);
    await $(".immersive-view").waitForDisplayed({ reverse: true, timeout: 20000 });
  });

  it("closes a highlighted document without saving while the annotation bar is open", async () => {
    await closeAllDocuments();
    await openInViewer(copyFixture(fixtures().sample, "discard.pdf"));
    if (!(await button(t("annotate.highlight")).isDisplayed())) await clickButton(t("viewer.annotate"));
    await clickButton(t("annotate.highlight"));
    const page = $('[data-page-index="0"]');
    await page.waitForDisplayed();
    await browser.waitUntil(async () => (await page.$$("img, canvas").length) > 0, { timeoutMsg: "page 1 never rendered" });
    const box = await browser.execute(() => {
      const rect = (document.querySelector('[data-page-index="0"]') as HTMLElement).getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width };
    });
    const scale = box.width / 595;
    const at = (x: number) => ({ origin: "viewport" as const, x: Math.round(box.left + x * scale), y: Math.round(box.top + 84 * scale) });
    await browser.action("pointer", { parameters: { pointerType: "mouse" } }).move(at(66)).down().move({ ...at(200), duration: 300 }).up().perform();

    await closeAllDocuments();

    await expect($(`//*[normalize-space(.)="${t("app.crashTitle")}"]`)).not.toBeExisting();
    await openInViewer(copyFixture(fixtures().sample, "after-discard.pdf"));
  });

  it("closes every document after one was opened while the annotation bar was open", async () => {
    await closeAllDocuments();
    await openInViewer(copyFixture(fixtures().sample, "bar-a.pdf"));
    await openInViewer(copyFixture(fixtures().sample, "bar-b.pdf"));
    if (!(await button(t("annotate.highlight")).isDisplayed())) await clickButton(t("viewer.annotate"));
    await openInViewer(copyFixture(fixtures().sample, "bar-c.pdf"));

    await closeAllDocuments();

    await expect($(`//*[normalize-space(.)="${t("app.crashTitle")}"]`)).not.toBeExisting();
    await openInViewer(copyFixture(fixtures().sample, "bar-after.pdf"));
  });

  it("says why a document past the open limit is not opened and opens it once there is room", async () => {
    await closeAllDocuments();
    for (let index = 1; index <= 20; index += 1) await openInViewer(copyFixture(fixtures().sample, `limit-${index}.pdf`));
    const extra = copyFixture(fixtures().sample, "limit-extra.pdf");

    answerDialogs(extra);
    await pressShortcut("o");
    await waitForDialogsAnswered();

    await $(`//*[@role="alert"][contains(normalize-space(.), "${t("errors.reasons.tooManyDocuments", { max: 20 })}")]`).waitForDisplayed({ timeout: 30000 });
    expect(await $$(`[role="tab"]`).length).toBe(20);
    await closeAllDocuments();
    await openInViewer(extra);
  });

  it("keeps the open documents and the viewer when the page reloads", async () => {
    const first = copyFixture(fixtures().chapters, "reload-a.pdf");
    const second = copyFixture(fixtures().sample, "reload-b.pdf");
    await openInViewer(first);
    await openInViewer(second);
    await browser.refresh();
    await $(`input[aria-label="${t("viewer.pageNumber")}"]`).waitForDisplayed({ timeout: 60000 });
    await expect($(`//span[normalize-space(.)="/ 3"]`)).toBeDisplayed();
    await expect($(`//*[@role="tab"][contains(normalize-space(.), "reload-a.pdf")]`)).toBeDisplayed();
    await expect($(`//*[contains(text(), "${t("crash.detectedToast")}")]`)).not.toBeDisplayed();
  });

  it("follows an internal link and returns with Alt Left", async () => {
    const path = copyFixture(fixtures().academic, "linked.pdf");
    await openInViewer(path);
    const pageInput = $(`input[aria-label="${t("viewer.pageNumber")}"]`);
    await expect(pageInput).toHaveValue("i");
    await expect($(`//span[normalize-space(.)="(1 / 8)"]`)).toBeDisplayed();
    const link = await pagePoint(0, 200, 123);
    await browser.pause(800);
    await browser.action("pointer", { parameters: { pointerType: "mouse" } }).move(link).down().up().perform();
    await expect(pageInput).toHaveValue("4");
    await expect($(`//span[normalize-space(.)="(6 / 8)"]`)).toBeDisplayed();
    await expect($("[data-annotation-menu]")).not.toBeDisplayed();

    await pressAlt(LEFT_KEY);
    await expect(pageInput).toHaveValue("i");
    await pressAlt(RIGHT_KEY);
    await expect(pageInput).toHaveValue("4");
    await pressAlt(LEFT_KEY);
    await expect(pageInput).toHaveValue("i");
  });

  it("previews where an internal link leads while the pointer rests on it", async () => {
    const path = copyFixture(fixtures().academic, "preview.pdf");
    await openInViewer(path);
    const pageInput = $(`input[aria-label="${t("viewer.pageNumber")}"]`);
    await expect(pageInput).toHaveValue("i");
    const link = await pagePoint(0, 200, 123);
    await browser.pause(800);
    await browser.action("pointer", { parameters: { pointerType: "mouse" } }).move(link).perform();
    const preview = $("[data-link-preview]");
    await expect(preview).toBeDisplayed({ wait: 5000 });
    await expect(preview).toHaveText(expect.stringContaining(t("viewer.link.goToPage", { page: "4" })));
    const image = preview.$(`img[alt="${t("viewer.linkPreview.alt", { page: "4" })}"]`);
    await expect(image).toBeDisplayed({ wait: 5000 });
    await browser.waitUntil(async () => (await browser.execute(() => document.querySelector<HTMLImageElement>("[data-link-preview] img")?.naturalWidth ?? 0)) > 0, { timeoutMsg: "the preview image never loaded" });
    const away = await pagePoint(0, 450, 300);
    await browser.action("pointer", { parameters: { pointerType: "mouse" } }).move(away).perform();
    await expect(preview).not.toBeDisplayed({ wait: 5000 });
    await expect(pageInput).toHaveValue("i");
  });

  it("navigates by the outline and by printed page labels", async () => {
    const path = copyFixture(fixtures().academic, "outline.pdf");
    await openInViewer(path);
    const pageInput = $(`input[aria-label="${t("viewer.pageNumber")}"]`);
    await clickButton(t("viewer.outline.title"));
    const tree = $(`[role="tree"][aria-label="${t("viewer.outline.title")}"]`);
    await tree.waitForDisplayed({ timeout: 30000 });
    const item = (title: string) => tree.$(`.//*[@role="treeitem"][.//span[normalize-space(text())="${title}"]]`);
    await expect(item("Preface")).toHaveAttribute("aria-selected", "true");
    await expect(item("Method")).not.toBeExisting();

    await item("Chapter 2").click();
    await expect(pageInput).toHaveValue("4");
    await expect(item("Chapter 2")).toHaveAttribute("aria-selected", "true");
    await pressAlt(LEFT_KEY);
    await expect(pageInput).toHaveValue("i");

    await item("Chapter 1").click();
    await expect(pageInput).toHaveValue("1");
    await expect(item("Method")).not.toBeExisting();
    await browser.keys(RIGHT_KEY);
    await expect(item("Method")).toBeDisplayed();
    await browser.keys(DOWN_KEY);
    await browser.keys(ENTER_KEY);
    await expect(pageInput).toHaveValue("2");
    await expect(item("Method")).toHaveAttribute("aria-selected", "true");

    await typeInto($(`input[aria-label="${t("viewer.outline.filter")}"]`), "chap");
    await expect(item("Preface")).not.toBeExisting();
    await expect(item("Chapter 2")).toBeDisplayed();

    await typeInto(pageInput, "ii");
    await browser.keys(ENTER_KEY);
    await expect($(`//span[normalize-space(.)="(2 / 8)"]`)).toBeDisplayed();
    await typeInto(pageInput, "3");
    await browser.keys(ENTER_KEY);
    await expect($(`//span[normalize-space(.)="(5 / 8)"]`)).toBeDisplayed();
    await clickButton(t("viewer.outline.title"));
    await tree.waitForDisplayed({ reverse: true });
  });

  it("switches between one page and the two-page views with and without a separate cover page", async () => {
    const path = copyFixture(fixtures().six, "spread.pdf");
    await openInViewer(path);
    const tops = () =>
      browser.execute(() =>
        [0, 1, 2].map((index) => Math.round(document.querySelector<HTMLElement>(`[data-page-index="${index}"]`)?.getBoundingClientRect().top ?? -1)),
      );
    const displayItem = (id: string) => $(`[role="menu"] [data-menu-id="${id}"]`);
    const chooseDisplay = async (id: string) => {
      await clickButton(t("viewer.pageDisplay.title"));
      await displayItem(id).waitForClickable();
      await displayItem(id).click();
      await displayItem(id).waitForDisplayed({ reverse: true });
    };

    await chooseDisplay("display-two");
    await browser.waitUntil(async () => {
      const [first, second, third] = await tops();
      return first === second && second !== third;
    }, { timeoutMsg: "pages 1 and 2 are not side by side" });

    await chooseDisplay("display-cover");
    await browser.waitUntil(async () => {
      const [first, second, third] = await tops();
      return first !== second && second === third;
    }, { timeoutMsg: "the cover page is not on its own" });

    await chooseDisplay("display-single");
    await browser.waitUntil(async () => {
      const [first, second, third] = await tops();
      return first < second && second < third;
    }, { timeoutMsg: "the pages are not one under the other again" });
    await clickButton(t("viewer.pageDisplay.title"));
    await expect(displayItem("display-single")).toHaveAttribute("aria-checked", "true");
    await expect(displayItem("display-cover")).toHaveAttribute("aria-checked", "false");
    await browser.keys(ESCAPE_KEY);
  });

  it("asks before closing a document with unsaved annotations", async () => {
    const path = copyFixture(fixtures().sample, "unsaved.pdf");
    await openInViewer(path);
    await clickButton(t("viewer.annotate"));
    await clickButton(t("annotate.highlight"));
    const start = await pagePoint(0, 66, 84);
    const end = await pagePoint(0, 200, 84);
    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move(start)
      .down()
      .move({ ...end, duration: 300 })
      .up()
      .perform();
    await expect($(`//*[contains(normalize-space(.), "${t("viewer.save.unsaved")}")]`)).toBeDisplayed();

    const tab = $(`//*[@role="tab"][contains(normalize-space(.), "unsaved.pdf")]`);
    await pressShortcut("w");
    await expect($(`//*[normalize-space(text())="${t("viewer.unsavedClose.title")}"]`)).toBeDisplayed();
    await clickButton(t("common.cancel"));
    await expect(tab).toBeDisplayed();

    await pressShortcut("w");
    await clickButton(t("viewer.unsavedClose.discard"));
    await tab.waitForDisplayed({ reverse: true });
    expect(probe(path).pages?.[0].annotations).toEqual([]);
  });

  it("keeps the frosted glass of bars and menus in the built styles", async () => {
    const filters = await browser.execute(() =>
      ["glass", "glass-flat", "glass-menu", "glass-chip"].map((name) => {
        const probe = document.createElement("div");
        probe.className = name;
        document.body.append(probe);
        const value = getComputedStyle(probe).backdropFilter;
        probe.remove();
        return `${name}: ${value}`;
      }),
    );

    for (const filter of filters) expect(filter).toContain("blur(");
  });

  it("opens a Markdown file as a PDF copy and saves it as a PDF", async () => {
    const source = join(workDir(), "open-notes.md");
    writeFileSync(source, ["# Meeting notes", "", "First paragraph of the notes.", "", "- one", "- two", ""].join("\n"));
    const target = join(workDir(), "open-notes-saved.pdf");
    const tab = (name: string) => $(`//*[@role="tab"][@aria-selected="true"][.//span[normalize-space(.)="${name}"]]`);
    answerDialogs(source);
    await pressShortcut("o");
    await waitForDialogsAnswered();
    await tab("open-notes.pdf").waitForDisplayed({ timeout: 120000, timeoutMsg: "the converted Markdown file never opened" });
    const banner = $(`//*[@role="status"][contains(normalize-space(.), "${t("viewer.converted.message", { name: "open-notes.md" })}")]`);
    await banner.waitForDisplayed({ timeoutMsg: "the converted-copy bar is missing" });

    answerDialogs(target);
    await clickButton(t("viewer.converted.saveAsPdf"));
    await waitForDialogsAnswered();
    await waitForFile(target);
    await tab("open-notes-saved.pdf").waitForDisplayed({ timeoutMsg: "the tab did not move to the saved PDF" });
    await banner.waitForExist({ reverse: true, timeoutMsg: "the converted-copy bar stayed after saving" });
    expect((await probe(target)).pageCount).toBeGreaterThan(0);
    await closeAllDocuments();
  });

  it("opens an e-mail with its headers in the interface language and the attachment kept", async () => {
    const source = join(workDir(), "open-invite.eml");
    writeFileSync(
      source,
      [
        "From: Ayse Demir <ayse@example.com>",
        "To: Team <team@example.com>",
        "Subject: Kick-off meeting",
        "Date: Fri, 02 Oct 2026 10:30:00 +0300",
        "MIME-Version: 1.0",
        'Content-Type: multipart/mixed; boundary="b1"',
        "",
        "--b1",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "See you on Monday.",
        "--b1",
        'Content-Type: text/plain; name="agenda.txt"',
        'Content-Disposition: attachment; filename="agenda.txt"',
        "",
        "1. Welcome",
        "--b1--",
        "",
      ].join("\r\n"),
    );
    const tab = $(`//*[@role="tab"][@aria-selected="true"][.//span[normalize-space(.)="open-invite.pdf"]]`);
    answerDialogs(source);
    await pressShortcut("o");
    await waitForDialogsAnswered();
    await tab.waitForDisplayed({ timeout: 120000, timeoutMsg: "the converted e-mail never opened" });
    const converted = join(tmpdir(), "vivepdf-converted");
    const copies = readdirSync(converted, { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith("open-invite.pdf"));
    const copy = probe(join(converted, copies[copies.length - 1]));
    const text = (copy.pages?.[0].text ?? "").normalize("NFKC");
    expect(text).toContain("Kick-off meeting");
    expect(text).toMatch(new RegExp(`${t("mail.sender")}\\s+Ayse Demir`));
    expect(text).toContain("agenda.txt");
    expect(copy.attachments).toContain("agenda.txt");
    await closeAllDocuments();
  });

  it("closes a tab from its close button", async () => {
    const first = copyFixture(fixtures().sample, "tab-close-a.pdf");
    const second = copyFixture(fixtures().second, "tab-close-b.pdf");
    await openInViewer(first);
    await openInViewer(second);
    const tab = (name: string) => $(`//*[@role="tab"][.//span[normalize-space(.)="${name}"]]`);
    const closeButton = (name: string) => $(`//*[@role="tab"][.//span[normalize-space(.)="${name}"]]//*[@data-tab-close]`);

    await closeButton("tab-close-b.pdf").click();
    await tab("tab-close-b.pdf").waitForExist({ reverse: true, timeoutMsg: "the active tab stayed open after its close button" });

    await tab("tab-close-a.pdf").waitForDisplayed();
    await tab("tab-close-a.pdf").moveTo();
    await closeButton("tab-close-a.pdf").click();
    await tab("tab-close-a.pdf").waitForExist({ reverse: true, timeoutMsg: "the last tab stayed open after its close button" });
  });

  it("reopens a document at the page where reading stopped", async () => {
    await browser.execute(() => {
      const preferences = JSON.parse(localStorage.getItem("vivepdf.preferences") ?? "{}") as Record<string, unknown>;
      localStorage.setItem("vivepdf.preferences", JSON.stringify({ ...preferences, rememberRecent: true }));
    });
    await browser.refresh();
    await $(`nav[aria-label="${t("nav.workspace")}"]`).waitForExist({ timeout: 60000 });
    const path = copyFixture(fixtures().academic, "resume.pdf");
    await openInViewer(path);
    const tab = $(`//*[@role="tab"][contains(normalize-space(.), "resume.pdf")]`);
    await expect(tab).toHaveAttribute("aria-selected", "true", { wait: 30000 });
    const pageInput = $(`input[aria-label="${t("viewer.pageNumber")}"]`);
    await expect($(`//span[normalize-space(.)="(1 / 8)"]`)).toBeDisplayed({ wait: 30000 });
    await typeInto(pageInput, "3");
    await browser.keys(ENTER_KEY);
    await expect($(`//span[normalize-space(.)="(5 / 8)"]`)).toBeDisplayed();
    await pressShortcut("w");
    await tab.waitForDisplayed({ reverse: true });

    await openInViewer(path);
    await expect(tab).toHaveAttribute("aria-selected", "true", { wait: 30000 });
    await expect($(`//span[normalize-space(.)="(5 / 8)"]`)).toBeDisplayed({ wait: 30000 });
    await expect($(`//*[contains(text(), "${t("viewer.resume.toast")}")]`)).toBeDisplayed();
    await clickButton(t("viewer.resume.fromStart"));
    await expect(pageInput).toHaveValue("i");
  });
});
