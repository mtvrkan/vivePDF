import { expect, test, type Page } from "@playwright/test";

async function openViewer(page: Page): Promise<void> {
  await page.goto("/e2e/playground.html?lang=en");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __marks: string[] }).__marks), { timeout: 20_000 }).toContain("first-page");
}

const viewer = (page: Page) => page.getByTestId("viewer");

test("search finds Turkish words, counts them and steps through the hits", async ({ page }) => {
  await openViewer(page);

  await viewer(page).getByRole("button", { name: "Search", exact: true }).click();
  await viewer(page).getByRole("searchbox", { name: "Search in document" }).fill("Chapter 40");
  const count = viewer(page).locator(".vp-search-count");

  await expect(count).toHaveText(/^1 of \d+$/, { timeout: 15_000 });
  await expect(viewer(page).getByRole("textbox", { name: "Page number" })).toHaveValue("40");

  await viewer(page).getByRole("searchbox", { name: "Search in document" }).fill("öğrenciler");
  await expect(count).toHaveText(/^1 of \d{3,}$/, { timeout: 15_000 });
  await viewer(page).getByRole("searchbox", { name: "Search in document" }).press("Enter");
  await expect(count).toHaveText(/^2 of /);
});

test("a word that is not there says so, and Escape gives focus back", async ({ page }) => {
  await openViewer(page);
  await viewer(page).getByRole("button", { name: "Search", exact: true }).click();

  await viewer(page).getByRole("searchbox", { name: "Search in document" }).fill("zzqxw");

  await expect(viewer(page).locator(".vp-search-count")).toHaveText("No results", { timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(viewer(page).getByRole("searchbox")).toHaveCount(0);
  await expect(viewer(page).getByRole("button", { name: "Search", exact: true })).toBeFocused();
});
