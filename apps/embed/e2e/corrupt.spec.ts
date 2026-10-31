import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const CORPUS = readdirSync(join(import.meta.dirname, "..", "bench", "fixtures", "corrupt")).filter((name) => name.endsWith(".pdf")).sort();
const SETTLED = ["first-page", "open-error"];

const marks = (page: Page) => page.evaluate(() => (window as unknown as { __marks: string[] }).__marks);
const viewer = (page: Page) => page.getByTestId("viewer");

async function openCorrupt(page: Page, file: string, load = "range"): Promise<string[]> {
  await page.goto(`/e2e/playground.html?lang=en&load=${load}&src=/fixtures/corrupt/${file}`);
  await expect.poll(async () => (await marks(page)).some((name) => SETTLED.includes(name)), { timeout: 10_000, message: file }).toBe(true);
  return marks(page);
}

test.beforeEach(({ isMobile }) => {
  test.skip(isMobile, "file parsing does not depend on the device profile");
});

for (const load of ["range", "full"]) {
  test(`every file of the corrupt corpus either opens or says what is wrong (${load})`, async ({ page }) => {
    test.setTimeout(CORPUS.length * 12_000);
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(error.message));

    const outcomes: string[] = [];
    for (const file of CORPUS) {
      const seen = await openCorrupt(page, file, load);
      outcomes.push(`${file}: ${seen.filter((name) => SETTLED.includes(name) || (name.startsWith("engine-") && name !== "engine-ready")).join(",")}`);
    }

    expect(failures).toEqual([]);
    expect(outcomes.filter((line) => !/: (first-page|open-error)$/.test(line))).toEqual([]);
  });
}

test("a document with unreadable pages still shows the pages that can be read", async ({ page }) => {
  const seen = await openCorrupt(page, "hand-kids-many-missing.pdf");

  expect(seen).toContain("first-page");
  await expect(viewer(page).getByText("/ 5001")).toBeVisible();
});

test("a document without pages says so and offers the file", async ({ page }) => {
  await openCorrupt(page, "hand-no-pages.pdf");

  const alert = viewer(page).getByRole("alert");

  await expect(alert).toContainText("This document has no pages");
  await expect(alert.getByRole("link", { name: "Download the file" })).toBeVisible();
});

for (const file of ["hand-empty.pdf", "hand-pages-cycle.pdf"]) {
  test(`an unreadable structure is reported as damaged, not as a network problem (${file})`, async ({ page }) => {
    await openCorrupt(page, file);

    await expect(viewer(page).getByRole("alert")).toContainText("The file is damaged");
  });
}
