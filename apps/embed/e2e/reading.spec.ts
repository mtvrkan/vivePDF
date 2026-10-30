import { expect, test, type Page } from "@playwright/test";

async function openViewer(page: Page, query = "lang=en"): Promise<void> {
  await page.goto(`/e2e/playground.html?${query}`);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __marks: string[] }).__marks), { timeout: 20_000 }).toContain("first-page");
}

const viewer = (page: Page) => page.getByTestId("viewer");

test("the page box jumps to a typed page and clamps past the end", async ({ page }) => {
  await openViewer(page);
  const pageBox = viewer(page).getByRole("textbox", { name: "Page number" });

  await pageBox.fill("250");
  await pageBox.press("Enter");

  await expect(pageBox).toHaveValue("250");
  await expect(viewer(page).locator('[data-page-index="249"]')).toBeInViewport();

  await pageBox.fill("9999");
  await pageBox.press("Enter");

  await expect(pageBox).toHaveValue("500");
});

test("zoom buttons change the shown level", async ({ page }) => {
  await openViewer(page);
  const level = viewer(page).getByRole("status").filter({ hasText: "%" });
  const before = await level.textContent();

  await viewer(page).getByRole("button", { name: "Zoom in" }).click();

  await expect(level).not.toHaveText(before ?? "");
});

test("the more menu switches to two pages and closes with Escape", async ({ page }) => {
  await openViewer(page);
  const more = viewer(page).getByRole("button", { name: "More options" });

  await more.click();
  await viewer(page).getByRole("menuitemradio", { name: "Two pages side by side" }).click();
  await more.click();

  await expect(viewer(page).getByRole("menuitemradio", { name: "Two pages side by side" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(viewer(page).getByRole("menu")).toHaveCount(0);
  await expect(more).toBeFocused();
});

test("Turkish labels and the dark theme follow the element attributes", async ({ page }) => {
  await openViewer(page, "lang=tr&theme=dark");

  await expect(viewer(page).getByRole("button", { name: "Yakınlaştır" })).toBeVisible();
  await expect(viewer(page).locator(".vp")).toHaveAttribute("data-theme", "dark");
});
