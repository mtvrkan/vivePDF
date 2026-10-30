import { expect, test, type Page } from "@playwright/test";

const marks = (page: Page) => page.evaluate(() => (window as unknown as { __marks: string[] }).__marks);
const viewer = (page: Page) => page.getByTestId("viewer");

test("an engine that cannot load says so and starts on Try again", async ({ page, context }) => {
  await context.route("**/pdfium.wasm", (route) => route.abort());
  await page.goto("/e2e/playground.html?lang=en&src=/fixtures/small.pdf");

  await expect(viewer(page).getByRole("alert")).toContainText("The viewer could not start", { timeout: 20_000 });
  await context.unroute("**/pdfium.wasm");
  await viewer(page).getByRole("button", { name: "Try again" }).click();

  await expect.poll(() => marks(page), { timeout: 20_000 }).toContain("first-page");
});

test("a crashed engine restarts by itself on the page the reader was on", async ({ page }) => {
  await page.goto("/e2e/playground.html?lang=en&src=/fixtures/book.pdf");
  await expect.poll(() => marks(page), { timeout: 20_000 }).toContain("first-page");
  const pageNumber = viewer(page).getByRole("textbox", { name: "Page number" });
  await pageNumber.fill("40");
  await pageNumber.press("Enter");
  await expect(viewer(page).locator('[data-page-index="39"]')).toBeInViewport();

  const engineWorker = page.workers().find((worker) => worker.url().includes("engine-worker"));
  if (!engineWorker) throw new Error("no engine worker");
  await engineWorker.evaluate(() => {
    setTimeout(() => {
      throw new Error("simulated crash");
    });
  });

  await expect.poll(() => marks(page), { timeout: 20_000 }).toContain("engine-crash");
  await expect.poll(async () => (await marks(page)).filter((name) => name === "document-open").length, { timeout: 20_000 }).toBe(2);
  await expect(viewer(page).locator('[data-page-index="39"]')).toBeInViewport();
  await page.waitForTimeout(500);
  await expect(pageNumber).toHaveValue("40");
  await expect(viewer(page).locator('[data-page-index="39"]')).toBeInViewport();
});
