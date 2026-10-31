import { expect, test, type Page } from "@playwright/test";
import type { VivePdfViewer } from "../src/api/types";

const marks = (page: Page) => page.evaluate(() => (window as unknown as { __marks: string[] }).__marks);
const viewer = (page: Page) => page.getByTestId("viewer");
const element = (page: Page) => page.locator("vive-pdf");

async function openViewer(page: Page, query: string): Promise<void> {
  await page.goto(`/e2e/playground.html?lang=en&src=/fixtures/annotated.pdf&zoom=fit-page&${query}`);
  await expect.poll(() => marks(page), { timeout: 20_000 }).toContain("first-page");
}

async function strokeOnPage(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const box = await viewer(page).locator('[data-page-index="0"]').boundingBox();
  if (!box) throw new Error("page not shown");
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) await page.mouse.move(box.x + box.width * (from[0] + ((to[0] - from[0]) * step) / 8), box.y + box.height * (from[1] + ((to[1] - from[1]) * step) / 8));
  await page.mouse.up();
}

test.skip(({ isMobile }) => isMobile, "mouse drawing is checked on desktop");

test("annotations() called from the change event already has the change in it", async ({ page }) => {
  await openViewer(page, "annotate");
  await element(page).evaluate((node: VivePdfViewer) => {
    const target = window as unknown as { __seen: number[] };
    target.__seen = [];
    node.addEventListener("vive-annotationchange", () => {
      void node.annotations().then((list) => target.__seen.push(list.length));
    });
  });
  const before = (await element(page).evaluate((node: VivePdfViewer) => node.annotations())).length;
  await element(page).evaluate((node: VivePdfViewer) => node.setTool("rectangle"));

  await strokeOnPage(page, [0.55, 0.75], [0.8, 0.85]);

  await expect.poll(() => page.evaluate(() => (window as unknown as { __seen: number[] }).__seen)).toEqual([before + 1]);
});

test("annotations() answers while the viewer is hidden", async ({ page }) => {
  await openViewer(page, "annotate");
  await element(page).evaluate((node: HTMLElement) => {
    node.style.display = "none";
  });
  await page.waitForTimeout(300);

  const count = await element(page).evaluate((node: VivePdfViewer) => Promise.race([node.annotations().then((list) => list.length), new Promise<number>((resolve) => window.setTimeout(() => resolve(-1), 3000))]));

  expect(count).toBe(4);
});

test("a setAnnotations call made while hidden does not reach the next document", async ({ page }) => {
  await openViewer(page, "annotate");
  await element(page).evaluate((node: HTMLElement) => {
    node.style.display = "none";
  });
  await page.waitForTimeout(300);
  const outcome = await element(page).evaluate(async (node: VivePdfViewer) => {
    const waiting = node.setAnnotations([]).then(
      () => "applied",
      (error: { code?: string }) => error.code ?? "failed",
    );
    const opened = node.open("/fixtures/annotated.pdf");
    node.style.display = "";
    await opened;
    return { waiting: await waiting, count: (await node.annotations()).length };
  });

  expect(outcome).toEqual({ waiting: "applied", count: 4 });
});

test("annotations() right after open() lists the new document's drawings", async ({ page }) => {
  await openViewer(page, "annotate");

  const count = await element(page).evaluate(async (node: VivePdfViewer) => {
    await node.open("/fixtures/annotated.pdf");
    return (await node.annotations()).length;
  });

  expect(count).toBe(4);
});

async function typeNote(page: Page, words: string): Promise<void> {
  await element(page).evaluate((node: VivePdfViewer) => node.setTool("note"));
  const box = await viewer(page).locator('[data-page-index="0"]').boundingBox();
  if (!box) throw new Error("page not shown");
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.32);
  const field = viewer(page).getByRole("textbox", { name: "Note text" });
  await field.click();
  await page.keyboard.type(words);
}

const noteTexts = (page: Page) => element(page).evaluate(async (node: VivePdfViewer) => (await node.annotations()).flatMap((entry) => (entry.type === "note" ? [entry.text] : [])));

test("save() while the note box still has focus keeps what was typed", async ({ page }) => {
  await openViewer(page, "annotate");
  await typeNote(page, "Okundu");

  const saved = await element(page).evaluate(async (node: VivePdfViewer) => new Uint8Array(await (await node.save()).arrayBuffer()).join(","));

  const bytes = Buffer.from(saved.split(",").map(Number));
  const wanted = Buffer.from("Okundu", "utf16le");
  for (let index = 0; index < wanted.length; index += 2) [wanted[index], wanted[index + 1]] = [wanted[index + 1], wanted[index]];
  expect(bytes.includes(wanted) || bytes.includes(Buffer.from("Okundu"))).toBe(true);
});

test("tapping the page beside an open note keeps what was typed", async ({ page }) => {
  await openViewer(page, "annotate");
  await typeNote(page, "Okundu");
  const box = await viewer(page).locator('[data-page-index="0"]').boundingBox();
  if (!box) throw new Error("page not shown");

  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.15);

  await expect.poll(() => noteTexts(page)).toContain("Okundu");
});

test("hasChanges turns on with a drawing or setAnnotations() and off for the next document", async ({ page }) => {
  await openViewer(page, "annotate");
  const changed = () => element(page).evaluate((node: VivePdfViewer) => node.hasChanges);
  const fresh = await changed();
  await element(page).evaluate((node: VivePdfViewer) => node.setTool("rectangle"));

  await strokeOnPage(page, [0.55, 0.75], [0.8, 0.85]);
  const drawn = await changed();
  await element(page).evaluate((node: VivePdfViewer) => node.open("/fixtures/annotated.pdf"));
  const reopened = await changed();
  await element(page).evaluate((node: VivePdfViewer) => node.setAnnotations([]));

  expect([fresh, drawn, reopened, await changed()]).toEqual([false, true, false, true]);
});

test("with the toolbar off, drawing through the API still gets the note box styles, keys and touch lock", async ({ page }) => {
  await openViewer(page, "annotate&toolbar=off");
  await element(page).evaluate((node: VivePdfViewer) => node.setTool("note"));
  const locked = await viewer(page).evaluate((node) => node.shadowRoot?.querySelector(".vp")?.hasAttribute("data-drawing"));
  const box = await viewer(page).locator('[data-page-index="0"]').boundingBox();
  if (!box) throw new Error("page not shown");
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.32);
  const width = await viewer(page).locator(".vp-note-editor").evaluate((node) => getComputedStyle(node).width);
  await element(page).evaluate((node: VivePdfViewer) => node.setTool("rectangle"));
  await viewer(page).locator(".vp-viewport").focus();

  await page.keyboard.press("Escape");
  await strokeOnPage(page, [0.55, 0.75], [0.8, 0.85]);

  expect({ locked, width }).toEqual({ locked: true, width: "240px" });
  expect((await element(page).evaluate((node: VivePdfViewer) => node.annotations())).filter((entry) => entry.type === "rectangle")).toHaveLength(1);
});

test("drawing tools that cannot load say so and load again with the next document", async ({ page, context }) => {
  await context.route(/\/chunks\/annotate-[^/]+\.js$/, (route) => route.abort());
  await openViewer(page, "annotate");
  const answer = () => element(page).evaluate((node: VivePdfViewer) => node.annotations().then((list) => `ok ${list.length}`, (error: { code: string; message: string }) => `${error.code} ${error.message}`));

  const broken = await answer();
  await context.unroute(/\/chunks\/annotate-[^/]+\.js$/);
  await element(page).evaluate((node: VivePdfViewer) => node.open("/fixtures/annotated.pdf"));

  expect([broken, await answer()]).toEqual(["failed vive-pdf: the drawing tools could not load", "ok 4"]);
  expect(await marks(page)).toContain("annotate-error");
});
