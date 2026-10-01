import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { $, $$, browser, expect } from "@wdio/globals";
import { ENTER_KEY, answerDialogs, bootApp, clickButton, copyFixture, fixtures, openInViewer, probe, t, typeInto, waitForDialogsAnswered, waitForFile, workDir } from "../support/app.ts";
import { PAGE_WIDTH, clearClipboard, pagePoint, pagePoints, waitForClipboardPicture, waitForClipboardText } from "../support/desktop.ts";

const ESCAPE_KEY = String.fromCharCode(0xe00c);
const SETTLE_MS = 800;
const FIRST_LINE = "Menu check first line";
const SECOND_LINE = "second line of the paragraph";
const TRAPPED_COMMANDS = ["plugin:opener|open_url", "search_picture_with_lens", "open_produced_picture"];

type Opened = { cmd: string; args: Record<string, unknown> };

async function trapExternalOpens() {
  await browser.execute((trapped: string[]) => {
    const host = window as unknown as { __e2eOpened?: Opened[] };
    if (host.__e2eOpened) return;
    host.__e2eOpened = [];
    const original = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const address = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const command = decodeURIComponent(new URL(address, location.href).pathname.slice(1));
      if (address.startsWith("http://ipc.localhost/") && trapped.includes(command)) {
        host.__e2eOpened?.push({ cmd: command, args: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
        return Promise.resolve(new Response("null", { headers: { "Content-Type": "application/json", "Tauri-Response": "ok" } }));
      }
      return original(input, init);
    };
  }, TRAPPED_COMMANDS);
}

async function takeOpened(): Promise<Opened[]> {
  return browser.execute(() => {
    const host = window as unknown as { __e2eOpened?: Opened[] };
    const taken = host.__e2eOpened?.splice(0) ?? [];
    return taken;
  });
}

async function waitForOpened(what: string): Promise<Opened> {
  let opened: Opened[] = [];
  await browser.waitUntil(
    async () => {
      opened = await takeOpened();
      return opened.length > 0;
    },
    { timeout: 15000, timeoutMsg: `${what}: nothing was opened` },
  );
  expect(opened).toHaveLength(1);
  return opened[0];
}

async function selectText(pageIndex: number, from: [number, number], to: [number, number]) {
  const [start, end] = await pagePoints(pageIndex, [from, to]);
  await browser.pause(SETTLE_MS);
  await browser
    .action("pointer", { parameters: { pointerType: "mouse" } })
    .move(start)
    .down()
    .move({ ...end, duration: 300 })
    .up()
    .perform();
}

async function openMenu(pageIndex: number, x: number, y: number) {
  const point = await pagePoint(pageIndex, x, y);
  await browser.action("pointer", { parameters: { pointerType: "mouse" } }).move(point).down({ button: 2 }).up({ button: 2 }).perform();
  await $(`[role="menu"][aria-label="${t("viewer.context.title")}"]`).waitForDisplayed();
}

const PARENTS: Record<string, string[]> = {
  translate: ["translate-menu"],
  "translate-google": ["translate-menu"],
  "copy-paragraph": ["copy-as"],
  "copy-quotation": ["copy-as"],
  "copy-markdown": ["copy-as"],
  "copy-code": ["copy-as"],
  "copy-page-image": ["page-export"],
  "save-page-png": ["page-export"],
  "extract-page": ["page-export"],
  snapshot: ["page-export"],
  "zoom-area": ["page-view"],
  "rotate-forward": ["page-view"],
  "rotate-backward": ["page-view"],
  "searchable-page": ["page-selectable"],
  "searchable-document": ["page-selectable"],
};

async function openSubmenu(id: string) {
  const parent = $(`[role="menu"] [data-menu-id="${id}"]`);
  await parent.waitForClickable({ timeout: 20000, timeoutMsg: `submenu ${id} never became clickable` });
  await parent.moveTo();
  await expect(parent).toHaveAttribute("aria-expanded", "true");
}

async function topLevelItems(): Promise<string[]> {
  return browser.execute((label: string) => {
    const menus = document.querySelectorAll(`[role="menu"][aria-label="${label}"]`);
    return Array.from(menus).flatMap((menu) => Array.from(menu.querySelectorAll("[data-menu-id]"), (entry) => entry.getAttribute("data-menu-id") ?? ""));
  }, t("viewer.context.title"));
}

async function closeMenu() {
  await browser.keys(ESCAPE_KEY);
  await $(`[role="menu"][aria-label="${t("viewer.context.title")}"]`).waitForDisplayed({ reverse: true, timeoutMsg: "menu stayed open after Escape" });
}

async function waitForTopLevel(expected: string[], absent: string[], what: string) {
  let top: string[] = [];
  try {
    await browser.waitUntil(
      async () => {
        top = await topLevelItems();
        return expected.every((id) => top.includes(id)) && absent.every((id) => !top.includes(id));
      },
      { timeout: 15000 },
    );
  } catch {
    throw new Error(`${what}: top level was ${top.join(", ")}`);
  }
}

async function choose(id: string, groups: string[] = []) {
  for (const parent of [...groups, ...(PARENTS[id] ?? [])]) await openSubmenu(parent);
  const item = $(`[role="menu"] [data-menu-id="${id}"]`);
  await item.waitForClickable({ timeout: 20000, timeoutMsg: `menu item ${id} never became clickable` });
  await item.click();
  await $(`[role="menu"][aria-label="${t("viewer.context.title")}"]`).waitForDisplayed({ reverse: true, timeoutMsg: `menu stayed open after ${id}` });
}

async function expectNoErrorToast(what: string) {
  const alerts = await $$('[role="alert"]').map((alert) => alert.getText());
  expect({ what, alerts }).toEqual({ what, alerts: [] });
}

async function dismissErrorToasts() {
  for (const close of await $$(`[role="alert"] button`)) await close.click().catch(() => undefined);
}

function lastSaveDialog(): { defaultPath?: string } {
  const log = readFileSync(`${process.env.VIVEPDF_E2E_DIALOG_FILE as string}.log`, "utf8").trim().split("\n");
  const saves = log.map((line) => JSON.parse(line) as { command: string; options: { defaultPath?: string } }).filter((entry) => entry.command === "save");
  return saves[saves.length - 1]?.options ?? {};
}

describe("viewer context menu", () => {
  let path = "";

  before(async () => {
    await bootApp();
    path = copyFixture(fixtures().illustrated, "menu check.pdf");
    await openInViewer(path);
    await trapExternalOpens();
  });

  afterEach(async () => {
    await browser.keys(ESCAPE_KEY);
    await dismissErrorToasts();
  });

  describe("on selected text", () => {
    it("copies the text as it is, as a paragraph, as a quotation, as markdown and as code", async () => {
      await selectText(0, [70, 84], [302, 120]);
      clearClipboard();
      await openMenu(0, 150, 84);
      await choose("copy-text");
      await waitForClipboardText((text) => text === `${FIRST_LINE}\n${SECOND_LINE}`, "copy text");

      clearClipboard();
      await openMenu(0, 150, 84);
      await choose("copy-paragraph");
      await waitForClipboardText((text) => text === `${FIRST_LINE} ${SECOND_LINE}`, "copy as paragraph");

      clearClipboard();
      await openMenu(0, 150, 84);
      await choose("copy-quotation");
      await waitForClipboardText((text) => text === t("viewer.context.quotation", { text: `${FIRST_LINE} ${SECOND_LINE}`, page: "1" }), "copy as quotation");

      clearClipboard();
      await openMenu(0, 150, 84);
      await choose("copy-markdown");
      await waitForClipboardText((text) => text === `${FIRST_LINE}\n${SECOND_LINE}`, "copy as markdown");

      clearClipboard();
      await openMenu(0, 150, 84);
      await choose("copy-code");
      await waitForClipboardText((text) => text.includes(FIRST_LINE) && text.includes(SECOND_LINE), "copy as code");
      await expectNoErrorToast("copy");
    });

    it("opens the group of what was clicked and folds the others into submenus", async () => {
      await selectText(0, [70, 84], [240, 84]);
      await openMenu(0, 150, 84);
      await waitForTopLevel(["copy-text", "copy-as", "search-web", "group-page"], ["copy-paragraph", "go-to-page", "zoom-area"], "on the selection");
      await closeMenu();

      await openMenu(0, 280, 362);
      await waitForTopLevel(["copy-image", "lens", "group-selection", "group-page"], ["copy-text", "go-to-page"], "on a picture beside the selection");
      await closeMenu();

      await openMenu(0, 400, 600);
      await waitForTopLevel(["go-to-page", "page-export", "page-view", "page-selectable", "group-selection"], ["copy-text", "copy-image", "copy-page-image"], "on blank page");
      await closeMenu();

      await openMenu(0, 150, 84);
      await choose("go-to-page", ["group-page"]);
      await expect($(`[role="dialog"] input[aria-label="${t("viewer.pageNumber")}"]`)).toHaveValue("1");
      await browser.keys(ESCAPE_KEY);
    });

    it("turns a selected bullet into a markdown list item", async () => {
      await selectText(0, [70, 156], [175, 156]);
      clearClipboard();
      await openMenu(0, 120, 156);
      await choose("copy-markdown");
      await waitForClipboardText((text) => text === "- bullet entry", "bullet as markdown");
    });

    it("keeps a selection whose drag ends on blank page past the end of the line", async () => {
      await selectText(0, [70, 84], [480, 84]);
      clearClipboard();
      await openMenu(0, 150, 84);
      await choose("copy-text");
      await waitForClipboardText((text) => text === FIRST_LINE, "drag past the end of one line");

      await selectText(0, [70, 84], [480, 120]);
      clearClipboard();
      await openMenu(0, 150, 84);
      await choose("copy-text");
      await waitForClipboardText((text) => text === `${FIRST_LINE}\n${SECOND_LINE}`, "drag past the end of the next line");
    });

    it("searches the document for the selection", async () => {
      await selectText(0, [70, 84], [240, 84]);
      await openMenu(0, 150, 84);
      await choose("search-doc");
      const input = $(`input[aria-label="${t("viewer.search")}"]`);
      await expect(input).toBeDisplayed();
      await expect(input).toHaveValue(FIRST_LINE);
    });

    it("opens every web search entry at the right address", async () => {
      await selectText(0, [70, 84], [240, 84]);
      const query = encodeURIComponent(FIRST_LINE);
      const expected: Record<string, string> = {
        "web-default": `https://www.google.com/search?q=${query}`,
        "web-google": `https://www.google.com/search?q=${query}`,
        "web-bing": `https://www.bing.com/search?q=${query}`,
        "web-ddg": `https://duckduckgo.com/?q=${query}`,
        "web-scholar": `https://scholar.google.com/scholar?q=${query}`,
        "web-wikipedia": `https://en.wikipedia.org/w/index.php?search=${query}`,
        "web-define": `https://en.wiktionary.org/wiki/${query}`,
      };
      for (const [id, url] of Object.entries(expected)) {
        await openMenu(0, 150, 84);
        await choose(id, ["search-web"]);
        const opened = await waitForOpened(id);
        expect({ id, cmd: opened.cmd, url: opened.args.url }).toEqual({ id, cmd: "plugin:opener|open_url", url });
      }
      await expectNoErrorToast("web search");
    });

    it("sends the selection to the offline translator", async () => {
      await selectText(0, [70, 84], [240, 84]);
      await openMenu(0, 150, 84);
      await choose("translate");
      await expect($(`aside[aria-label="${t("viewer.translate.title")}"]`)).toBeDisplayed();
      await clickButton(t("viewer.translate.title")).catch(() => undefined);
    });

    it("opens the selection in Google Translate in the interface language", async () => {
      await selectText(0, [70, 84], [240, 84]);
      await openMenu(0, 150, 84);
      await choose("translate-google");
      const opened = await waitForOpened("translate-google");
      expect({ cmd: opened.cmd, url: opened.args.url }).toEqual({
        cmd: "plugin:opener|open_url",
        url: `https://translate.google.com/?sl=auto&tl=en&text=${encodeURIComponent(FIRST_LINE)}&op=translate`,
      });
      await expectNoErrorToast("Google Translate");
    });

    it("reads the selection aloud", async () => {
      await selectText(0, [70, 84], [240, 84]);
      await openMenu(0, 150, 84);
      await choose("read-aloud");
      const unavailable = $(`//*[contains(text(), "${t("viewer.selection.readAloudUnavailable")}")]`);
      await browser.waitUntil(async () => (await browser.execute(() => window.speechSynthesis.speaking || window.speechSynthesis.pending)) || (await unavailable.isExisting()), {
        timeout: 10000,
        timeoutMsg: "reading aloud neither started nor reported that speech is missing",
      });
      await browser.execute(() => window.speechSynthesis.cancel());
    });
  });

  describe("on a picture", () => {
    const picture: [number, number] = [280, 362];

    it("copies the picture", async () => {
      clearClipboard();
      await openMenu(0, ...picture);
      await choose("copy-image");
      const copied = await waitForClipboardPicture("copy picture");
      expect(copied.width).toBeGreaterThan(900);
      expect(copied.height).toBeGreaterThan(120);
      await expectNoErrorToast("copy picture");
    });

    it("saves the picture under the name it suggests", async () => {
      const output = join(workDir(), "saved picture.jpg");
      answerDialogs(output);
      await openMenu(0, ...picture);
      await choose("save-image");
      await waitForDialogsAnswered();
      await waitForFile(output);
      expect(readFileSync(output).subarray(0, 2).toString("hex")).toBe("ffd8");
      expect(lastSaveDialog().defaultPath).toMatch(/menu check-picture-1\.jpg$/);
      await expectNoErrorToast("save picture");
    });

    it("opens the picture it wrote in the default app", async () => {
      await openMenu(0, ...picture);
      await choose("open-image");
      const opened = await waitForOpened("open picture");
      expect(opened.cmd).toBe("open_produced_picture");
      const written = String(opened.args.path);
      expect(written).toMatch(/\.jpg$/);
      expect(existsSync(written) && statSync(written).size > 0).toBe(true);
    });

    it("sends the picture to Google Lens", async () => {
      await openMenu(0, ...picture);
      await choose("lens");
      const opened = await waitForOpened("lens");
      expect(opened.cmd).toBe("search_picture_with_lens");
      expect(String(opened.args.pngBase64)).toMatch(/^iVBORw0KGgo/);
      expect(Number(opened.args.width)).toBeGreaterThan(900);
      expect(Number(opened.args.height)).toBeGreaterThan(120);
      await expectNoErrorToast("lens");
    });

    it("reads the words in the picture", async () => {
      await openMenu(0, ...picture);
      await choose("image-text");
      let read = "";
      await browser.waitUntil(
        async () => {
          read = await browser.execute(() => Array.from(document.querySelectorAll("textarea")).map((area) => area.value).join(" "));
          return read.trim().length > 0;
        },
        { timeout: 90000, timeoutMsg: "the words in the picture were never shown" },
      );
      expect(read.trim()).toBe("PICTURE WORDS 42");
    });

    it("selects the picture for editing", async () => {
      await openMenu(0, ...picture);
      await choose("edit-image");
      await expect($('[data-page-index="0"] [data-move-handle]')).toBeDisplayed({ wait: 30000 });
      await clickButton(t("common.cancel")).catch(() => undefined);
    });
  });

  describe("on a page", () => {
    before(async () => {
      await browser.refresh();
      await $(`input[aria-label="${t("viewer.pageNumber")}"]`).waitForDisplayed({ timeout: 60000 });
      await trapExternalOpens();
    });

    it("copies the page as a picture", async () => {
      clearClipboard();
      await openMenu(1, 400, 600);
      await choose("copy-page-image");
      const copied = await waitForClipboardPicture("copy page picture");
      expect(copied.width).toBe(1600);
      await expectNoErrorToast("copy page picture");
    });

    it("saves the page as a PNG at the chosen resolution", async () => {
      const output = join(workDir(), "page two.png");
      await openMenu(1, 400, 600);
      await choose("save-page-png");
      await expect($(`//*[normalize-space(text())="${t("viewer.context.savePagePngTitle", { page: 2 })}"]`)).toBeDisplayed();
      answerDialogs(output);
      await clickButton(t("viewer.context.savePagePngConfirm"));
      await waitForDialogsAnswered();
      await waitForFile(output);
      expect(readFileSync(output).readUInt32BE(16)).toBe(Math.round((PAGE_WIDTH * 150) / 72));
      await expectNoErrorToast("save page png");
    });

    it("extracts the page it was opened on into its own PDF", async () => {
      const output = join(workDir(), "only page two.pdf");
      answerDialogs(output);
      await openMenu(1, 400, 600);
      await choose("extract-page");
      await waitForDialogsAnswered();
      await waitForFile(output);
      const extracted = probe(output);
      expect(extracted.pageCount).toBe(1);
      expect(extracted.pages?.[0].text).toContain("Menu check second page");
      expect(lastSaveDialog().defaultPath).toMatch(/menu check-page-2\.pdf$/);
      await expectNoErrorToast("extract page");
    });

    it("turns the view both ways", async () => {
      const shape = () =>
        browser.execute(() => {
          const rect = (document.querySelector('[data-page-index="0"]') as HTMLElement).getBoundingClientRect();
          return rect.width > rect.height ? "wide" : "tall";
        });
      expect(await shape()).toBe("tall");
      await openMenu(0, 400, 600);
      await choose("rotate-forward");
      await browser.waitUntil(async () => (await shape()) === "wide", { timeoutMsg: "the view did not turn clockwise" });
      const point = await pagePoint(0, 300, 200);
      await browser.action("pointer", { parameters: { pointerType: "mouse" } }).move(point).down({ button: 2 }).up({ button: 2 }).perform();
      await choose("rotate-backward");
      await browser.waitUntil(async () => (await shape()) === "tall", { timeoutMsg: "the view did not turn back" });
      expect(probe(path).pages?.[0].rotation).toBe(0);
    });

    it("opens printing for just that page", async () => {
      await openMenu(1, 400, 600);
      await choose("print-page");
      await expect($(`input[aria-label="${t("viewer.printDialog.pagesRange")}"]`)).toHaveValue("2");
      await browser.keys(ESCAPE_KEY);
      await expect($(`input[aria-label="${t("viewer.printDialog.pagesRange")}"]`)).not.toBeDisplayed();
    });

    it("goes to the page typed into the prompt", async () => {
      const pageInput = $(`input[aria-label="${t("viewer.pageNumber")}"]`);
      await openMenu(0, 400, 600);
      await choose("go-to-page");
      const prompt = $(`[role="dialog"] input[aria-label="${t("viewer.pageNumber")}"]`);
      await expect(prompt).toHaveValue("1");
      await typeInto(prompt, "2");
      await browser.keys(ENTER_KEY);
      await expect(pageInput).toHaveValue("2");
    });

    it("asks before making one page or the whole document selectable", async () => {
      for (const id of ["searchable-page", "searchable-document"]) {
        await openMenu(0, 300, 300);
        await choose(id);
        await expect($(`//*[normalize-space(text())="${t("viewer.searchable.title")}"]`)).toBeDisplayed();
        await clickButton(t("common.cancel"));
        await expect($(`//*[normalize-space(text())="${t("viewer.searchable.title")}"]`)).not.toBeDisplayed();
      }
    });

    it("queues a bookmark at the clicked spot", async () => {
      await openMenu(1, 400, 600);
      await choose("add-bookmark");
      const name = $(`[role="dialog"] input[aria-label="${t("viewer.context.bookmarkName")}"]`);
      await expect(name).toHaveValue(t("viewer.context.bookmarkDefaultTitle", { page: 2 }));
      await typeInto(name, "Second page mark");
      await clickButton(t("viewer.context.addBookmarkConfirm"));
      await expect($(`//*[contains(text(), "${t("viewer.context.bookmarkQueued", { title: "Second page mark" })}")]`)).toBeDisplayed();
    });

    it("copies a link to the page", async () => {
      clearClipboard();
      await openMenu(1, 400, 600);
      await choose("copy-page-link");
      const link = await waitForClipboardText((text) => text.length > 0, "copy page link");
      expect(link).toMatch(/^file:\/\/\/.*menu%20check\.pdf#page=2$/);
    });

    it("copies an area drawn after choosing the snapshot as a picture", async () => {
      clearClipboard();
      await openMenu(0, 400, 600);
      await choose("snapshot");
      await selectText(0, [72, 330], [492, 394]);
      const picture = await waitForClipboardPicture("snapshot");
      expect(picture.width).toBeGreaterThanOrEqual(840);
      expect(picture.width / picture.height).toBeCloseTo(420 / 64, 0);
    });

    it("zooms into the area drawn after choosing it", async () => {
      const width = () => browser.execute(() => (document.querySelector('[data-page-index="0"]') as HTMLElement).getBoundingClientRect().width);
      const before = await width();
      await openMenu(0, 400, 600);
      await choose("zoom-area");
      await selectText(0, [70, 70], [240, 140]);
      await browser.waitUntil(async () => (await width()) > before * 1.5, { timeoutMsg: "the drawn area was not zoomed into" });
    });

  });
});
