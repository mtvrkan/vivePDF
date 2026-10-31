import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { VivePdfAnnotation, VivePdfViewer } from "../src/api/types";

const marks = (page: Page) => page.evaluate(() => (window as unknown as { __marks: string[] }).__marks);
const viewer = (page: Page) => page.getByTestId("viewer");
const element = (page: Page) => page.locator("vive-pdf");
const changes = (page: Page) => page.evaluate(() => (window as unknown as { __events: { type: string; detail: unknown }[] }).__events.filter((event) => event.type === "vive-annotationchange").map((event) => event.detail));

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

const pens = async (page: Page) => (await element(page).evaluate((node: VivePdfViewer) => node.annotations())).filter((entry) => entry.type === "pen").map((entry) => ({ color: entry.color, strokes: entry.type === "pen" ? entry.strokes.length : 0 }));

test("strokes drawn while the pen stays on become one drawing", async ({ page }) => {
  await openViewer(page, "annotate");
  const existing = (await element(page).evaluate((node: VivePdfViewer) => node.annotations())).filter((entry) => entry.type === "pen").length;
  await pickTool(page, "Pen");

  await strokeOnPage(page, [0.2, 0.72], [0.3, 0.8]);
  await strokeOnPage(page, [0.32, 0.72], [0.42, 0.8]);
  await strokeOnPage(page, [0.44, 0.72], [0.54, 0.8]);

  const drawn = (await element(page).evaluate((node: VivePdfViewer) => node.annotations())).filter((entry) => entry.type === "pen");
  expect(drawn).toHaveLength(existing + 1);
  expect(drawn.map((entry) => (entry.type === "pen" ? entry.strokes.length : 0)).sort()).toContain(3);
  expect(count(await downloaded(page), "Ink")).toBe(existing + 1);
  await expect(viewer(page).getByRole("toolbar", { name: "Drawing tools" }).getByRole("button", { name: "Delete selected" })).toBeDisabled();
});

test("a new colour starts a new drawing and leaves the earlier one as it was", async ({ page }) => {
  await openViewer(page, "annotate");
  await pickTool(page, "Pen");
  await strokeOnPage(page, [0.2, 0.72], [0.3, 0.8]);

  await viewer(page).getByRole("radio", { name: "Blue" }).click();
  await strokeOnPage(page, [0.32, 0.72], [0.42, 0.8]);
  await strokeOnPage(page, [0.44, 0.72], [0.54, 0.8]);

  expect(await pens(page)).toEqual(
    expect.arrayContaining([
      { color: "#E44234", strokes: 1 },
      { color: "#1F6FEB", strokes: 2 },
    ]),
  );
});

test("undo takes back only the last stroke of the drawing", async ({ page }) => {
  await openViewer(page, "annotate");
  await pickTool(page, "Pen");
  await viewer(page).getByRole("radio", { name: "Blue" }).click();
  await strokeOnPage(page, [0.2, 0.72], [0.3, 0.8]);
  await strokeOnPage(page, [0.32, 0.72], [0.42, 0.8]);
  const bar = viewer(page).getByRole("toolbar", { name: "Drawing tools" });

  await bar.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => pens(page)).toEqual(expect.arrayContaining([{ color: "#1F6FEB", strokes: 1 }]));
  await strokeOnPage(page, [0.44, 0.72], [0.54, 0.8]);

  await expect.poll(() => pens(page)).toEqual(expect.arrayContaining([{ color: "#1F6FEB", strokes: 2 }]));
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

test("a site reads the annotations, puts its own in their place and saves the result", async ({ page }) => {
  await openViewer(page, "annotate");
  const own: VivePdfAnnotation[] = [
    { type: "pen", page: 1, color: "#1F6FEB", opacity: 1, width: 4, strokes: [[{ x: 100, y: 600 }, { x: 300, y: 650 }]] },
    { type: "note", page: 1, color: "#FFCD45", opacity: 1, text: "Kontrol edildi", box: { x: 400, y: 600, width: 20, height: 20 } },
  ];

  const before = await element(page).evaluate((node: VivePdfViewer) => node.annotations());
  const after = await element(page).evaluate(async (node: VivePdfViewer, list) => {
    await node.setAnnotations(list);
    return node.annotations();
  }, own);
  const reopened = await element(page).evaluate(async (node: VivePdfViewer) => {
    await node.open(await node.save());
    return node.annotations();
  });

  expect(before.map((entry) => entry.type).sort()).toEqual(["highlight", "note", "pen", "rectangle"]);
  expect(before.find((entry) => entry.type === "note")?.text).toBe("A sticky note");
  expect(after).toEqual(own);
  expect(reopened).toEqual(own);
  expect(await changes(page)).toEqual([]);
});

test("drawing tells the page what changed and setTool picks a tool from outside", async ({ page }) => {
  await openViewer(page, "annotate");

  await element(page).evaluate((node: VivePdfViewer) => node.setTool("rectangle"));
  await expect(viewer(page).getByRole("toolbar", { name: "Drawing tools" }).getByRole("button", { name: "Rectangle", exact: true })).toHaveAttribute("aria-pressed", "true");
  await strokeOnPage(page, [0.55, 0.75], [0.8, 0.85]);

  await expect.poll(() => changes(page)).toEqual([{ type: "create", page: 1 }]);
});

test("the annotation methods say why they cannot answer", async ({ page }) => {
  await openViewer(page, "");
  const off = await element(page).evaluate((node: VivePdfViewer) => node.annotations().then(() => "answered", (error: Error & { code: string }) => error.code));
  await element(page).evaluate((node) => node.setAttribute("annotate", ""));
  await expect(viewer(page).getByRole("button", { name: "Draw and annotate" })).toBeVisible();

  const wrong = await element(page).evaluate((node: VivePdfViewer) => node.setAnnotations([{ type: "stamp" } as never]).then(() => "answered", (error: Error & { code: string }) => `${error.code}: ${error.message}`));

  expect(off).toBe("annotate-off");
  expect(wrong).toBe("invalid: vive-pdf: annotation 0 is not valid: page must be a whole number from 1 to 1");
});

test("printing right after drawing puts the drawing on paper", async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as unknown as { __printed: boolean };
    target.__printed = false;
    window.print = () => {
      target.__printed = true;
    };
  });
  await openViewer(page, "annotate");
  await pickTool(page, "Pen");
  await viewer(page).getByRole("radio", { name: "Blue" }).click();
  await strokeOnPage(page, [0.2, 0.75], [0.6, 0.8]);

  await viewer(page).getByRole("button", { name: "More options" }).click();
  await viewer(page).getByRole("menuitem", { name: "Print" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __printed: boolean }).__printed)).toBe(true);

  const bluePixels = await page.evaluate(async () => {
    const image = document.querySelector<HTMLImageElement>(".vivepdf-print-root img");
    if (!image) return -1;
    await image.decode();
    const canvas = Object.assign(document.createElement("canvas"), { width: image.naturalWidth, height: image.naturalHeight });
    const context = canvas.getContext("2d");
    if (!context) return -1;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) if (pixels[index] < 90 && pixels[index + 1] > 80 && pixels[index + 1] < 150 && pixels[index + 2] > 200) count += 1;
    return count;
  });
  expect(bluePixels).toBeGreaterThan(50);
});

test("the keyboard deletes the selection, undoes, redoes and puts the tool down", async ({ page }) => {
  await openViewer(page, "annotate");
  await pickTool(page, "Rectangle");
  await strokeOnPage(page, [0.55, 0.75], [0.8, 0.85]);
  const bar = viewer(page).getByRole("toolbar", { name: "Drawing tools" });
  const rectangles = async () => (await element(page).evaluate((node: VivePdfViewer) => node.annotations())).filter((entry) => entry.type === "rectangle").length;
  await expect(bar.getByRole("button", { name: "Delete selected" })).toBeEnabled();

  await page.keyboard.press("Delete");
  await expect.poll(rectangles).toBe(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(rectangles).toBe(2);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(rectangles).toBe(1);
  await page.keyboard.press("Escape");

  await expect(bar.getByRole("button", { name: "Rectangle", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("a shape puts the tool down, stays selected and has a Delete button next to it", async ({ page }) => {
  await openViewer(page, "annotate");
  await pickTool(page, "Rectangle");

  await strokeOnPage(page, [0.55, 0.75], [0.8, 0.85]);

  const bar = viewer(page).getByRole("toolbar", { name: "Drawing tools" });
  await expect(bar.getByRole("button", { name: "Rectangle", exact: true })).toHaveAttribute("aria-pressed", "false");
  await viewer(page).getByRole("button", { name: "Delete", exact: true }).click();
  await expect.poll(async () => (await element(page).evaluate((node: VivePdfViewer) => node.annotations())).filter((entry) => entry.type === "rectangle").length).toBe(1);
});

test("a click beside the selected drawing lets go of it", async ({ page }) => {
  await openViewer(page, "annotate");
  await pickTool(page, "Ellipse");
  await strokeOnPage(page, [0.55, 0.75], [0.8, 0.85]);
  const remove = viewer(page).getByRole("toolbar", { name: "Drawing tools" }).getByRole("button", { name: "Delete selected" });
  await expect(remove).toBeEnabled();
  const box = await viewer(page).locator('[data-page-index="0"]').boundingBox();
  if (!box) throw new Error("page not shown");

  await page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.3);

  await expect(remove).toBeDisabled();
});

test("the eraser cuts pen lines where it is dragged and removes what is wiped out", async ({ page }) => {
  await openViewer(page, "annotate");
  await pickTool(page, "Pen");
  await viewer(page).getByRole("radio", { name: "Blue" }).click();
  await strokeOnPage(page, [0.2, 0.75], [0.6, 0.75]);
  await strokeOnPage(page, [0.2, 0.85], [0.25, 0.85]);
  await pickTool(page, "Eraser");

  await strokeOnPage(page, [0.4, 0.7], [0.4, 0.8]);
  await strokeOnPage(page, [0.18, 0.85], [0.27, 0.85]);

  await expect.poll(() => pens(page)).toEqual(expect.arrayContaining([{ color: "#1F6FEB", strokes: 2 }]));
  expect((await pens(page)).filter((entry) => entry.color === "#1F6FEB")).toHaveLength(1);
});

test("picking a text tool marks the text that is already selected", async ({ page }) => {
  await openViewer(page, "annotate");
  await strokeOnPage(page, [0.14, 0.607], [0.45, 0.607]);

  await pickTool(page, "Underline text");

  await expect.poll(async () => (await element(page).evaluate((node: VivePdfViewer) => node.annotations())).filter((entry) => entry.type === "underline").length).toBe(1);
});

test("delete all asks first, removes every drawing and can be undone", async ({ page }) => {
  await openViewer(page, "annotate");
  await pickTool(page, "Pen");
  await strokeOnPage(page, [0.2, 0.75], [0.6, 0.8]);
  const bar = viewer(page).getByRole("toolbar", { name: "Drawing tools" });
  const total = async () => (await element(page).evaluate((node: VivePdfViewer) => node.annotations())).length;
  const before = await total();

  await bar.getByRole("button", { name: "Delete all drawings" }).click();
  const dialog = viewer(page).getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect.poll(total).toBe(before);
  await bar.getByRole("button", { name: "Delete all drawings" }).click();
  await dialog.getByRole("button", { name: "Delete all" }).click();
  await expect.poll(total).toBe(0);
  await bar.getByRole("button", { name: "Undo" }).click();

  await expect.poll(total).toBeGreaterThan(0);
});

test("the note box takes a click and keeps what is typed", async ({ page }) => {
  await openViewer(page, "annotate");
  await pickTool(page, "Note");
  const box = await viewer(page).locator('[data-page-index="0"]').boundingBox();
  if (!box) throw new Error("page not shown");
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.32);
  const field = viewer(page).getByRole("textbox", { name: "Note text" });

  await field.click();
  await page.keyboard.type("Okundu");
  await field.blur();

  await expect.poll(async () => (await element(page).evaluate((node: VivePdfViewer) => node.annotations())).some((entry) => entry.type === "note" && entry.text === "Okundu")).toBe(true);
});
