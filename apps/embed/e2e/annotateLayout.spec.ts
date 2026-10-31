import { expect, test, type Page } from "@playwright/test";

const marks = (page: Page) => page.evaluate(() => (window as unknown as { __marks: string[] }).__marks);
const viewer = (page: Page) => page.getByTestId("viewer");

async function openViewer(page: Page): Promise<void> {
  await page.goto("/e2e/playground.html?lang=en&src=/fixtures/annotated.pdf&zoom=fit-page&annotate");
  await expect.poll(() => marks(page), { timeout: 20_000 }).toContain("first-page");
}

test("the More menu shows above the open drawing bar", async ({ page }) => {
  await openViewer(page);
  await viewer(page).getByRole("button", { name: "Draw and annotate" }).click();
  await viewer(page).getByRole("button", { name: "More options" }).click();

  const covered = await viewer(page)
    .locator('[role^="menuitem"]')
    .evaluateAll((items) =>
      items.flatMap((item) => {
        const box = item.getBoundingClientRect();
        if (box.width === 0) return [];
        const top = (item.getRootNode() as ShadowRoot).elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return top && (item === top || item.contains(top)) ? [] : [item.textContent];
      }),
    );

  expect(covered).toEqual([]);
});

test("undo, delete and close stay on screen in the drawing bar", async ({ page }) => {
  await openViewer(page);
  await viewer(page).getByRole("button", { name: "Draw and annotate" }).click();
  const bar = viewer(page).getByRole("toolbar", { name: "Drawing tools" });
  const frame = await viewer(page).boundingBox();
  if (!frame) throw new Error("viewer not shown");

  const outside: string[] = [];
  for (const name of ["Undo", "Redo", "Delete selected", "Delete all drawings", "Close drawing tools"]) {
    const box = await bar.getByRole("button", { name, exact: true }).boundingBox();
    if (!box || box.x < frame.x || box.x + box.width > frame.x + frame.width) outside.push(name);
  }

  expect(outside).toEqual([]);
});

test.describe("drawing bar keyboard", () => {
  test.skip(({ isMobile }) => isMobile, "keyboard use is checked on desktop");

  const openBar = async (page: Page) => {
    await openViewer(page);
    await viewer(page).getByRole("button", { name: "Draw and annotate" }).click();
    return viewer(page).getByRole("toolbar", { name: "Drawing tools" });
  };

  test("closing the drawing bar puts focus back on the Draw button", async ({ page }) => {
    const bar = await openBar(page);
    await bar.getByRole("button", { name: "Close drawing tools" }).focus();

    await page.keyboard.press("Enter");

    await expect(viewer(page).getByRole("button", { name: "Draw and annotate" })).toBeFocused();
  });

  test("arrow keys move through the colours and choose one, with one Tab stop for the group", async ({ page }) => {
    const bar = await openBar(page);
    const colours = bar.getByRole("radiogroup", { name: "Colour" });
    await colours.getByRole("radio", { name: "Red" }).focus();

    await page.keyboard.press("ArrowRight");

    await expect(colours.getByRole("radio", { name: "Yellow" })).toBeFocused();
    await expect(colours.getByRole("radio", { name: "Yellow" })).toHaveAttribute("aria-checked", "true");
    expect(await colours.locator('[tabindex="0"]').count()).toBe(1);
  });

  test("arrow keys move through the tools", async ({ page }) => {
    const bar = await openBar(page);
    await bar.getByRole("button", { name: "Pen", exact: true }).focus();

    await page.keyboard.press("ArrowRight");

    await expect(bar.getByRole("button", { name: "Marker", exact: true })).toBeFocused();
  });

  test("the hint is spoken because its status area is there before it fills", async ({ page }) => {
    await openBar(page);

    expect(await viewer(page).locator(".vp-draw-hint[role=status]").count()).toBe(1);
  });
});

test.describe("drawing bar widths", () => {
  test.skip(({ isMobile, browserName }) => isMobile || browserName !== "chromium", "the width sweep resizes one desktop window");

  for (const width of [300, 340, 390, 430, 480, 560, 640, 760, 900, 960, 1024]) {
    test(`at ${width} pixels the drawing bar, its actions and the hint fit without covering the toolbar`, async ({ page }) => {
      await page.setViewportSize({ width, height: 760 });
      await openViewer(page);
      await viewer(page).getByRole("button", { name: "Draw and annotate" }).click();
      const bar = viewer(page).getByRole("toolbar", { name: "Drawing tools" });
      await bar.getByRole("button", { name: "Pen", exact: true }).click();

      const frame = await viewer(page).boundingBox();
      const drawBar = await bar.boundingBox();
      const pill = await viewer(page).getByRole("toolbar", { name: "Document tools" }).boundingBox();
      const actions = await Promise.all(["Undo", "Redo", "Delete selected", "Delete all drawings", "Close drawing tools"].map((name) => bar.getByRole("button", { name, exact: true }).boundingBox()));
      await bar.getByRole("button", { name: "Eraser", exact: true }).click();
      const hint = await viewer(page).locator(".vp-draw-hint").boundingBox();
      if (!frame || !drawBar || !pill || !hint) throw new Error("bars not shown");

      expect(drawBar.x).toBeGreaterThanOrEqual(frame.x);
      expect(drawBar.x + drawBar.width).toBeLessThanOrEqual(frame.x + frame.width);
      expect(actions.every((box) => box !== null && box.x >= drawBar.x && box.x + box.width <= drawBar.x + drawBar.width)).toBe(true);
      expect(drawBar.y + drawBar.height).toBeLessThanOrEqual(pill.y);
      expect(hint.y + hint.height).toBeLessThanOrEqual(drawBar.y);
      expect(hint.x).toBeGreaterThanOrEqual(frame.x);
    });
  }
});

test("every control in the drawing bar has a name and keyboard focus is drawn", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard focus is checked on desktop");
  await openViewer(page);
  await viewer(page).getByRole("button", { name: "Draw and annotate" }).click();
  const bar = viewer(page).getByRole("toolbar", { name: "Drawing tools" });

  const unnamed = await bar.locator("button").evaluateAll((buttons) => buttons.filter((button) => !(button.getAttribute("aria-label") ?? button.textContent ?? "").trim()).length);
  await bar.getByRole("button", { name: "Pen", exact: true }).focus();
  await page.keyboard.press("Tab");
  const ring = await bar.locator(":focus-visible").evaluate((node) => getComputedStyle(node).outlineStyle);

  expect(unnamed).toBe(0);
  expect(ring).toBe("solid");
});
