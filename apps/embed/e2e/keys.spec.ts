import { expect, test, type Page } from "@playwright/test";

async function openViewer(page: Page, query = ""): Promise<void> {
  await page.addInitScript(() => {
    const copied: string[] = [];
    (window as unknown as { __copied: string[] }).__copied = copied;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          copied.push(text);
        },
      },
    });
  });
  await page.goto(`/e2e/playground.html?lang=en&${query}`);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __marks: string[] }).__marks), { timeout: 20_000 }).toContain("first-page");
}

const viewer = (page: Page) => page.getByTestId("viewer");
const pageNumber = (page: Page) => viewer(page).getByRole("textbox", { name: "Page number" });
const modifier = process.platform === "darwin" ? "Meta" : "Control";

test("Home and End go to the first and last page, the shortcut opens search", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard shortcuts need a hardware keyboard");
  await openViewer(page);

  await viewer(page).getByRole("region", { name: "Document pages" }).focus();
  await page.keyboard.press("End");
  await expect(pageNumber(page)).not.toHaveValue("1");
  await page.keyboard.press("Home");
  await expect(pageNumber(page)).toHaveValue("1");

  await page.keyboard.press(`${modifier}+f`);
  await expect(viewer(page).getByRole("searchbox", { name: "Search in document" })).toBeFocused();
});

test("dragging over text selects whole lines and the shortcut copies them", async ({ page, isMobile }) => {
  test.skip(isMobile, "touch selection is the long-press flow");
  await openViewer(page, "src=/fixtures/small.pdf");
  const box = await viewer(page).locator('[data-page-index="0"]').boundingBox();
  if (!box) throw new Error("first page has no box");

  await page.mouse.move(box.x + 95, box.y + 172);
  await page.mouse.down();
  for (let step = 1; step <= 20; step += 1) await page.mouse.move(box.x + 95 + step * 30, box.y + 172 + step * 1.5);
  await page.mouse.up();
  await page.keyboard.press(`${modifier}+c`);

  await expect.poll(() => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied.join(""))).toMatch(/web viewer benchmark text\. The quick brown/);
});
