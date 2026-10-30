import { expect, test, type Page } from "@playwright/test";

const marks = (page: Page) => page.evaluate(() => (window as unknown as { __marks: string[] }).__marks);
const viewer = (page: Page) => page.getByTestId("viewer");

async function openViewer(page: Page, query: string, until: "first-page" | "open-error"): Promise<void> {
  await page.goto(`/e2e/playground.html?lang=en&${query}`);
  await expect.poll(() => marks(page), { timeout: 20_000 }).toContain(until);
}

for (const load of ["range", "full"]) {
  test(`a locked file asks for its password and opens with the right one (${load})`, async ({ page }) => {
    await openViewer(page, `src=/fixtures/locked.pdf&load=${load}`, "open-error");
    const password = viewer(page).getByLabel("Password");
    await expect(viewer(page).getByText("This document is protected")).toBeVisible();
    await expect(password).toBeFocused();

    await password.fill("not-it");
    await password.press("Enter");

    await expect(viewer(page).getByText("That password is not right. Try again.")).toBeVisible();
    await expect(password).toHaveAttribute("aria-invalid", "true");
    await password.fill("vive-2026");
    await viewer(page).getByRole("button", { name: "Open" }).click();
    await expect.poll(() => marks(page), { timeout: 20_000 }).toContain("first-page");
    await expect(viewer(page).getByRole("textbox", { name: "Page number" })).toHaveValue("1");
  });

  test(`a missing file says so and offers to try again (${load})`, async ({ page }) => {
    await openViewer(page, `src=/fixtures/missing.pdf&load=${load}`, "open-error");

    await expect(viewer(page).getByRole("alert")).toContainText("File not found");
    await viewer(page).getByRole("button", { name: "Try again" }).click();

    await expect.poll(async () => (await marks(page)).filter((name) => name === "open-error").length, { timeout: 20_000 }).toBe(2);
    await expect(viewer(page).getByRole("alert")).toContainText("File not found");
  });
}

for (const file of ["truncated.pdf", "garbage.pdf", "notpdf.pdf"]) {
  test(`a file that is not a readable PDF is reported as damaged with a download link (${file})`, async ({ page }) => {
    await openViewer(page, `src=/fixtures/${file}`, "open-error");

    const alert = viewer(page).getByRole("alert");

    await expect(alert).toContainText("The file is damaged");
    await expect(alert.getByRole("link", { name: "Download the file" })).toHaveAttribute("href", new RegExp(`/fixtures/${file}$`));
  });
}

test("problems are told in Turkish too", async ({ page }) => {
  await page.goto("/e2e/playground.html?lang=tr&src=/fixtures/locked.pdf");
  await expect.poll(() => marks(page), { timeout: 20_000 }).toContain("open-error");

  await expect(viewer(page).getByText("Bu belge parolayla korunuyor")).toBeVisible();
  await expect(viewer(page).getByLabel("Parola")).toBeVisible();
});
