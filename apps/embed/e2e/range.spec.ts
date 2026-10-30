import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const marks = (page: Page) => page.evaluate(() => (window as unknown as { __marks: string[] }).__marks);
const viewer = (page: Page) => page.getByTestId("viewer");
const BOOK = readFileSync(new URL("../bench/fixtures/book.pdf", import.meta.url));

test("a server that ignores range requests still opens the whole file once", async ({ page, context }) => {
  const ranges: string[] = [];
  await context.route((url) => url.pathname === "/fixtures/book.pdf", (route) => {
    ranges.push(route.request().headers()["range"] ?? "none");
    return route.fulfill({ status: 200, contentType: "application/pdf", body: BOOK });
  });

  await page.goto("/e2e/playground.html?lang=en&src=/fixtures/book.pdf");

  await expect.poll(() => marks(page), { timeout: 20_000 }).toContain("first-page");
  const pageNumber = viewer(page).getByRole("textbox", { name: "Page number" });
  await pageNumber.fill("480");
  await pageNumber.press("Enter");
  await expect(viewer(page).locator('[data-page-index="479"] img')).toBeVisible();
  expect(ranges).toEqual(["bytes=0-65535"]);
});
