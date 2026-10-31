import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const marks = (page: Page) => page.evaluate(() => (window as unknown as { __marks: string[] }).__marks);
const viewer = (page: Page) => page.getByTestId("viewer");

async function openViewer(page: Page, query: string): Promise<void> {
  await page.goto(`/e2e/playground.html?lang=en&src=/fixtures/annotated.pdf&zoom=fit-page&${query}`);
  await expect.poll(() => marks(page), { timeout: 20_000 }).toContain("first-page");
}

async function pickTool(page: Page, tool: string): Promise<void> {
  const bar = viewer(page).getByRole("toolbar", { name: "Drawing tools" });
  if (!(await bar.isVisible())) await viewer(page).getByRole("button", { name: "Draw and annotate" }).click();
  await bar.getByRole("button", { name: tool, exact: true }).click();
}

async function strokeOnPage(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const box = await viewer(page).locator('[data-page-index="0"]').boundingBox();
  if (!box) throw new Error("page not shown");
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) {
    const x = from[0] + ((to[0] - from[0]) * step) / 12;
    const y = from[1] + ((to[1] - from[1]) * step) / 12;
    await page.mouse.move(box.x + box.width * x, box.y + box.height * y);
  }
  await page.mouse.up();
}

async function downloaded(page: Page): Promise<Buffer> {
  await viewer(page).getByRole("button", { name: "More options" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), viewer(page).getByRole("menuitem", { name: "Download" }).click()]);
  return readFileSync(await download.path());
}

const count = (pdf: Buffer, subtype: string) => (pdf.toString("latin1").match(new RegExp(`/Subtype\\s*/${subtype}\\b`, "g")) ?? []).length;

function utf16be(text: string): Buffer {
  const bytes = Buffer.from(text, "utf16le");
  for (let index = 0; index < bytes.length; index += 2) [bytes[index], bytes[index + 1]] = [bytes[index + 1], bytes[index]];
  return bytes;
}

test.skip(({ isMobile }) => isMobile, "drawing with a mouse is checked on desktop; touch drawing is a hand check");

test("without the annotate setting there is no drawing button and the drawing code is never fetched", async ({ page }) => {
  const fetched: string[] = [];
  page.on("request", (request) => fetched.push(request.url()));
  await openViewer(page, "");

  await expect(viewer(page).getByRole("toolbar", { name: "Document tools" })).toBeVisible();
  await expect(viewer(page).getByRole("button", { name: "Draw and annotate" })).toHaveCount(0);
  expect(fetched.filter((url) => url.includes("/chunks/annotate-"))).toEqual([]);
});

test("a pen stroke is saved into the downloaded PDF next to the annotations it already had", async ({ page }) => {
  await openViewer(page, "annotate");
  await pickTool(page, "Pen");

  await strokeOnPage(page, [0.2, 0.75], [0.6, 0.8]);
  const pdf = await downloaded(page);

  expect(count(pdf, "Ink")).toBe(2);
  expect([count(pdf, "Highlight"), count(pdf, "Square"), count(pdf, "Text")]).toEqual([1, 1, 1]);
});

test("undo takes the last stroke back and redo brings it again", async ({ page }) => {
  await openViewer(page, "annotate");
  await pickTool(page, "Rectangle");
  await strokeOnPage(page, [0.55, 0.6], [0.8, 0.75]);
  const bar = viewer(page).getByRole("toolbar", { name: "Drawing tools" });

  await bar.getByRole("button", { name: "Undo" }).click();

  await expect(bar.getByRole("button", { name: "Redo" })).toBeEnabled();
  expect(count(await downloaded(page), "Square")).toBe(1);

  await bar.getByRole("button", { name: "Redo" }).click();

  expect(count(await downloaded(page), "Square")).toBe(2);
});

test("a note keeps Turkish letters in the saved PDF", async ({ page }) => {
  await openViewer(page, "annotate");
  await pickTool(page, "Note");
  const box = await viewer(page).locator('[data-page-index="0"]').boundingBox();
  if (!box) throw new Error("page not shown");

  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.32);
  await viewer(page).getByRole("textbox", { name: "Note text" }).fill("Çalışkan öğrenci İĞDIR");
  await viewer(page).getByRole("textbox", { name: "Note text" }).blur();
  const pdf = await downloaded(page);

  expect(count(pdf, "Text")).toBe(2);
  expect(pdf.includes(utf16be("Çalışkan öğrenci İĞDIR"))).toBe(true);
});

test("dragging the highlight tool over text adds a highlight", async ({ page }) => {
  await openViewer(page, "annotate");
  await pickTool(page, "Highlight text");

  await strokeOnPage(page, [0.14, 0.607], [0.45, 0.607]);
  const pdf = await downloaded(page);

  expect(count(pdf, "Highlight")).toBe(2);
});

test("the selected drawing can be deleted", async ({ page }) => {
  await openViewer(page, "annotate");
  await pickTool(page, "Ellipse");
  await strokeOnPage(page, [0.55, 0.6], [0.8, 0.75]);
  const remove = viewer(page).getByRole("toolbar", { name: "Drawing tools" }).getByRole("button", { name: "Delete selected" });

  await expect(remove).toBeEnabled();
  await remove.click();

  expect(count(await downloaded(page), "Circle")).toBe(0);
});
