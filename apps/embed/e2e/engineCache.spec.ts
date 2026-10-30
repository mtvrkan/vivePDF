import { expect, test, type Page } from "@playwright/test";

const marks = (page: Page) => page.evaluate(() => (window as unknown as { __marks: string[] }).__marks);

test("the engine is kept in Cache Storage under the current build only", async ({ page }) => {
  await page.goto("/e2e/playground.html?lang=en&src=/fixtures/small.pdf");
  await page.evaluate(async () => {
    const stale = await caches.open("vivepdf-engine-stale");
    await stale.put("/dist/pdfium.wasm", new Response("old"));
  });
  await page.reload();
  await expect.poll(() => marks(page), { timeout: 20_000 }).toContain("first-page");

  const kept = async () =>
    page.evaluate(async () => {
      const names = (await caches.keys()).filter((name) => name.startsWith("vivepdf-engine-"));
      const entries = await Promise.all(names.map(async (name) => (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname)));
      return { names, entries };
    });

  await expect.poll(async () => (await kept()).names.length).toBe(1);
  const { names, entries } = await kept();
  expect(names[0]).toMatch(/^vivepdf-engine-[0-9a-f]{16}$/);
  expect(entries[0]).toEqual(["/dist/pdfium.wasm"]);
});
