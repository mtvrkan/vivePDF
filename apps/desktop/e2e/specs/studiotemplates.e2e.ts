import { join } from "node:path";
import { $, $$, browser, expect } from "@wdio/globals";
import { bootApp, openTool, t } from "../support/app.ts";

const CATEGORY = process.env.VIVEPDF_E2E_TEMPLATES ?? "";

type Problem = { element: string; issue: string };

async function showCategory(category: string) {
  const leave = $(`button[aria-label="${t("studio.toolbar.leave")}"]`);
  if (await leave.isExisting()) await leave.click();
  const filter = $(`[data-template-category="${category}"]`);
  await filter.waitForClickable({ timeout: 20000 });
  await filter.click();
}

async function openTemplate(category: string, id: string) {
  await showCategory(category);
  const card = $(`[data-template="${id}"]`);
  await card.waitForExist({ timeout: 20000 });
  await card.scrollIntoView({ block: "center" });
  await card.click();
  await $('[data-testid="studio-viewport"] [data-element-id]').waitForExist({ timeout: 30000 });
}

async function installLibraryFonts() {
  const banner = $('[data-testid="studio-missing-fonts"]');
  if (!(await banner.isExisting())) return;
  await banner.$("button").click();
  await banner.waitForExist({ reverse: true, timeout: 180000, timeoutMsg: "the library fonts were not installed" });
}

async function layoutProblems(): Promise<Problem[]> {
  return browser.execute(() => {
    const page = document.querySelector<HTMLElement>('[data-testid="studio-viewport"] [role="region"]');
    const sheet = page?.firstElementChild as HTMLElement | null;
    if (!sheet) return [{ element: "page", issue: "no page" }];
    const width = Number.parseFloat(sheet.style.width);
    const height = Number.parseFloat(sheet.style.height);
    const found: { element: string; issue: string }[] = [];
    for (const node of Array.from(sheet.querySelectorAll<HTMLElement>("[data-element-id]"))) {
      const left = Number.parseFloat(node.style.left);
      const top = Number.parseFloat(node.style.top);
      const name = (node.textContent ?? "").trim().slice(0, 30) || node.dataset.elementId || "";
      if (left >= width || top >= height || left + node.offsetWidth <= 0 || top + node.offsetHeight <= 0) found.push({ element: name, issue: "off the page" });
      const body = node.querySelector<HTMLElement>("[data-text-body]");
      if (body && (body.offsetHeight > node.offsetHeight + 2 || body.scrollWidth > node.offsetWidth + 2)) found.push({ element: name, issue: `text ${body.offsetWidth}×${body.offsetHeight} > box ${node.offsetWidth}×${node.offsetHeight}` });
    }
    return found;
  });
}

describe("studio templates", () => {
  before(bootApp);

  it("opens every template with its text inside its boxes", async () => {
    await openTool("nav.studio");
    await $("[data-template-category]").waitForExist({ timeout: 30000 });
    const available = await browser.execute(() => [...new Set(Array.from(document.querySelectorAll<HTMLElement>("[data-template-category]")).map((button) => button.dataset.templateCategory as string))].filter((category) => category !== "all"));
    const categories = CATEGORY ? available.filter((category) => CATEGORY.split(",").includes(category)) : available;
    expect(categories.length).toBeGreaterThan(0);

    const problems: string[] = [];
    let fontsReady = false;
    for (const category of categories) {
      await showCategory(category);
      const ids = await browser.execute(() => [...new Set(Array.from(document.querySelectorAll<HTMLElement>("[data-template]")).map((card) => card.dataset.template as string))]);
      for (const id of ids) {
        await openTemplate(category, id);
        if (!fontsReady) {
          await installLibraryFonts();
          fontsReady = true;
          await openTemplate(category, id);
        }
        await browser.pause(700);
        await $('[data-testid="studio-viewport"]').saveScreenshot(join(process.env.VIVEPDF_E2E_RUN_DIR as string, `template-${id}.png`));
        for (const problem of await layoutProblems()) problems.push(`${id}: ${problem.element} — ${problem.issue}`);
      }
    }

    expect(problems).toEqual([]);
    expect(await $$('[data-testid="studio-viewport"] [data-element-id]').length).toBeGreaterThan(0);
  });
});
