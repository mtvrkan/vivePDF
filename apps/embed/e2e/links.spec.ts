import { expect, test, type Page } from "@playwright/test";

async function openViewer(page: Page, query: string): Promise<void> {
  await page.goto(`/e2e/playground.html?lang=en&${query}`);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __marks: string[] }).__marks), { timeout: 20_000 }).toContain("first-page");
}

const viewer = (page: Page) => page.getByTestId("viewer");

test("a link to another page jumps there", async ({ page }) => {
  await openViewer(page, "src=/fixtures/links.pdf");

  await viewer(page).getByRole("button", { name: "Link to page 3" }).click();

  await expect(viewer(page).getByRole("textbox", { name: "Page number" })).toHaveValue("3");
});

test("web and mail links open safely and script links are dropped", async ({ page }) => {
  await openViewer(page, "src=/fixtures/links.pdf");
  const firstPage = viewer(page).locator('[data-page-index="0"]');

  const web = firstPage.locator('a[href="https://vivepdf.com/"]');
  await expect(web).toHaveAttribute("target", "_blank");
  await expect(web).toHaveAttribute("rel", "noopener noreferrer");
  await expect(firstPage.locator('a[href="mailto:info@example.com"]')).toHaveCount(1);
  await expect(firstPage.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(firstPage.locator(".vp-link")).toHaveCount(3);
});
