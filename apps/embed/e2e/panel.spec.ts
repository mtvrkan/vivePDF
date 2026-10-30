import { expect, test, type Page } from "@playwright/test";

async function openViewer(page: Page): Promise<void> {
  await page.goto("/e2e/playground.html?lang=en");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __marks: string[] }).__marks), { timeout: 20_000 }).toContain("first-page");
}

const viewer = (page: Page) => page.getByTestId("viewer");

async function showPanelTab(page: Page, tab: string): Promise<void> {
  if ((await viewer(page).getByRole("complementary", { name: "Side panel" }).count()) === 0) await viewer(page).getByRole("button", { name: "Side panel" }).click();
  await viewer(page).getByRole("tab", { name: tab }).click();
}

test("a thumbnail takes the reader to its page", async ({ page }) => {
  await openViewer(page);

  await viewer(page).getByRole("button", { name: "Side panel" }).click();
  await viewer(page).getByRole("button", { name: "Page 3", exact: true }).click();

  await expect(viewer(page).getByRole("textbox", { name: "Page number" })).toHaveValue("3");
});

test("the contents tab lists the outline and follows the current page", async ({ page }) => {
  await openViewer(page);
  await showPanelTab(page, "Contents");

  await viewer(page).getByRole("treeitem", { name: /Chapter 12\b/ }).click();

  await expect(viewer(page).getByRole("textbox", { name: "Page number" })).toHaveValue("12");
  await showPanelTab(page, "Pages");
  await showPanelTab(page, "Contents");
  await expect(viewer(page).getByRole("treeitem", { name: /Chapter 12\b/ })).toHaveAttribute("aria-current", "location");
});

test("the outline moves with the arrow keys and Escape closes the panel", async ({ page }) => {
  await openViewer(page);
  await viewer(page).getByRole("button", { name: "Side panel" }).click();
  await viewer(page).getByRole("tab", { name: "Contents" }).click();
  await viewer(page).getByRole("treeitem", { name: /Chapter 1\b/ }).focus();

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  await expect(viewer(page).getByRole("textbox", { name: "Page number" })).toHaveValue("3");
  await page.keyboard.press("Escape");
  await expect(viewer(page).getByRole("complementary", { name: "Side panel" })).toHaveCount(0);
  await expect(viewer(page).getByRole("button", { name: "Side panel" })).toBeFocused();
});
