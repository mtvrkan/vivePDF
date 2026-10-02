import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { browser, $, $$ } from "@wdio/globals";
import en from "../../src/locales/en/common.json" with { type: "json" };
import { E2E_DIR } from "./paths.ts";

export type Fixtures = Record<"sample" | "second" | "six" | "chapters" | "scanned" | "form" | "contacts" | "locked" | "long" | "annotated" | "academic" | "illustrated" | "covers" | "turned" | "signed" | "commented" | "layered" | "tagged" | "logo" | "badge" | "red" | "blue" | "answers" | "japanese" | "memo" | "banner", string>;

export type PageProbe = {
  text: string;
  rotation: number;
  label: string;
  width: number;
  height: number;
  annotations: string[];
  images: number;
  drawings: number;
  links: string[];
  spans: Array<{ text: string; size: number; bold: boolean; color: string; box: [number, number, number, number] }>;
  imageBoxes: Array<[number, number, number, number]>;
};

export type PdfProbe = {
  exists: boolean;
  encrypted?: boolean;
  unlocked?: boolean;
  bytes?: number;
  pageCount?: number;
  pages?: PageProbe[];
  fields?: Record<string, string>;
  signatureFields?: number;
  pdfaPart?: string | null;
  signatures?: Array<{ field: string; intact: boolean; coverage: string }>;
  comments?: Array<{ content: string; author: string; state: string | null; replyTo: string | null }>;
  figureAlts?: string[];
  layers?: number;
};

type Element = ReturnType<typeof $>;

type Catalog = { [key: string]: string | Catalog };

export function t(key: string, values: Record<string, string | number> = {}): string {
  const lookup = (path: string) => path.split(".").reduce<string | Catalog | undefined>((node, part) => (typeof node === "object" ? node[part] : undefined), en as Catalog);
  const count = values.count;
  const plural = typeof count === "number" ? lookup(`${key}_${new Intl.PluralRules("en").select(count)}`) : undefined;
  const found = typeof plural === "string" ? plural : lookup(key);
  if (typeof found !== "string") throw new Error(`missing locale key ${key}`);
  return found.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, name: string) => String(values[name] ?? ""));
}

export function workDir(): string {
  return process.env.VIVEPDF_E2E_WORK_DIR as string;
}

export function fixtures(): Fixtures {
  return JSON.parse(readFileSync(join(process.env.VIVEPDF_E2E_RUN_DIR as string, "fixtures.json"), "utf8")) as Fixtures;
}

export function copyFixture(source: string, name = basename(source)): string {
  const target = join(workDir(), name);
  copyFileSync(source, target);
  return target;
}

export function answerDialogs(...answers: Array<string | string[] | null>) {
  const file = process.env.VIVEPDF_E2E_DIALOG_FILE as string;
  const queue = JSON.parse(readFileSync(file, "utf8")) as unknown[];
  writeFileSync(file, JSON.stringify([...queue, ...answers]));
}

export function pendingDialogAnswers(): number {
  return (JSON.parse(readFileSync(process.env.VIVEPDF_E2E_DIALOG_FILE as string, "utf8")) as unknown[]).length;
}

export async function waitForDialogsAnswered() {
  await browser.waitUntil(() => pendingDialogAnswers() === 0, { timeoutMsg: "the app never asked for the queued dialog answers" });
}

export function probe(path: string, password?: string): PdfProbe {
  const args = [join(E2E_DIR, "support", "probe_pdf.py"), path];
  if (password) args.push(password);
  return JSON.parse(execFileSync(process.env.VIVEPDF_E2E_PYTHON as string, args, { encoding: "utf8" })) as PdfProbe;
}

export async function waitForFile(path: string, timeout = 120000) {
  await browser.waitUntil(() => existsSync(path) && statSync(path).size > 0, { timeout, timeoutMsg: `output never appeared: ${path}` });
}

export async function bootApp() {
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        if (document.readyState !== "complete" || !/^https?:$|^tauri:$/.test(location.protocol)) return false;
        try {
          return localStorage !== null;
        } catch {
          return false;
        }
      }),
    { timeout: 60000, timeoutMsg: "the app page never loaded" },
  );
  await browser.execute(() => {
    localStorage.setItem("vivepdf.locale", "en");
    localStorage.setItem("vivepdf.autoUpdateCheck", "off");
    localStorage.setItem(
      "vivepdf.preferences",
      JSON.stringify({ reduceMotion: true, rememberRecent: false, keepHistory: false, successToasts: false, searchAutoIndex: false, restoreSession: false, confirmClose: false }),
    );
  });
  await browser.refresh();
  await $(`nav[aria-label="${t("nav.workspace")}"]`).waitForExist({ timeout: 60000 });
  await browser.waitUntil(async () => (await browser.execute(() => document.documentElement.lang)) === "en", { timeout: 30000 });
  await waitForEngine();
}

async function waitForEngine() {
  await browser.waitUntil(
    async () =>
      browser.executeAsync((done: (answered: boolean) => void) => {
        const bridge = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
        bridge.invoke("rpc", { id: crypto.randomUUID(), method: "system.ping", params: {} }).then(
          () => done(true),
          () => done(false),
        );
      }),
    { timeout: 180000, interval: 1000, timeoutMsg: "the engine never answered a ping" },
  );
}

const CONTROL_KEY = String.fromCharCode(0xe009);
const BACKSPACE_KEY = String.fromCharCode(0xe003);
export const ENTER_KEY = String.fromCharCode(0xe007);

export async function pressShortcut(key: string) {
  await browser.keys([CONTROL_KEY, key]);
  await browser.keys([CONTROL_KEY]);
}

export async function openTool(labelKey: string) {
  const label = t(labelKey);
  await pressShortcut("k");
  const input = $(`input[aria-label="${t("palette.title")}"]`);
  await input.waitForDisplayed();
  await input.setValue(label);
  await browser.waitUntil(
    async () => {
      if ((await input.getValue()) === label) return true;
      await input.setValue(label);
      return false;
    },
    { timeout: 10000, timeoutMsg: `the palette search did not keep "${label}"` },
  );
  const option = $(`//*[@role="option"][.//*[normalize-space(text())="${label}"]]`);
  await option.waitForDisplayed();
  await option.click();
  await input.waitForDisplayed({ reverse: true });
}

export async function openInViewer(path: string) {
  answerDialogs(path);
  await pressShortcut("o");
  await waitForDialogsAnswered();
  await $(`//*[@role="tab"][@aria-selected="true"][.//span[@title="${basename(path)}"]]`).waitForDisplayed({ timeout: 60000, timeoutMsg: `the viewer never switched to ${basename(path)}` });
  await $(`input[aria-label="${t("viewer.pageNumber")}"]`).waitForDisplayed({ timeout: 60000 });
}

export async function closeAllDocuments() {
  const active = $(`//*[@role="tab"][@aria-selected="true"]`);
  if (!(await active.isExisting())) return;
  await active.click({ button: "right" });
  const closeAll = $(`//*[@role="menuitem"][normalize-space(.)="${t("viewer.context.closeAll")}"]`);
  await closeAll.waitForClickable();
  await closeAll.click();
  const discard = button(t("viewer.unsavedClose.discard"));
  const discardEdits = button(t("viewer.overlay.confirmDiscardDiscard"));
  const discardPages = $(`//*[@role="dialog"][.//*[normalize-space(.)="${t("tools.pages.leaveTitle")}"]]//button[normalize-space(.)="${t("viewer.save.discard")}"]`);
  await browser.waitUntil(
    async () => {
      if (await discardPages.isDisplayed()) await discardPages.click();
      if (await discardEdits.isDisplayed()) await discardEdits.click();
      if (await discard.isDisplayed()) await discard.click();
      return (await $$(`[role="tab"]`).length) === 0;
    },
    { timeout: 30000, timeoutMsg: "the open documents did not close" },
  );
}

export function button(label: string) {
  return $(`//button[normalize-space(.)="${label}" or @aria-label="${label}"]`);
}

export async function clickButton(label: string) {
  const target = button(label);
  await target.waitForClickable();
  await target.click();
}

export async function chooseSource(path: string, { locked = false }: { locked?: boolean } = {}) {
  answerDialogs(path);
  const choose = t("tools.chooseSource");
  const trigger = $(`//button[normalize-space(.)="${choose}" or normalize-space(.)="${t("tools.changeSource")}" or span[normalize-space(.)="${choose}"]]`);
  await trigger.waitForClickable();
  await trigger.click();
  await waitForDialogsAnswered();
  await $(`//span[@title="${path}"]`).waitForDisplayed({ timeout: 60000 });
  if (locked) {
    await $(`input[aria-label="${t("password.label")}"]`).waitForDisplayed({ timeout: 60000 });
    return;
  }
  await $(`//span[@title="${path}"]/following-sibling::span[contains(normalize-space(.), " ${t("info.pages")} ·")]`).waitForDisplayed({
    timeout: 60000,
    timeoutMsg: "source document info never loaded",
  });
}

export async function outputPath(): Promise<string> {
  const folderHint = await $(`//*[starts-with(normalize-space(.), "${t("tools.folder")}: ")]`).getText();
  const folder = folderHint.slice(`${t("tools.folder")}: `.length).trim();
  const name = await $(`input[aria-label="${t("tools.output")}"]`).getValue();
  return join(folder, name);
}

export async function waitForOutputs(timeout = 180000): Promise<string[]> {
  const outputs = `//li[.//button[@aria-label="${t("tools.reveal")}"]]/span[@title]`;
  const failure = `//*[normalize-space(text())="${t("tools.failed")}"]`;
  await browser.waitUntil(async () => (await $$(outputs).length) > 0 || (await $(failure).isExisting()), {
    timeout,
    timeoutMsg: "the operation never finished",
  });
  if (await $(failure).isExisting()) {
    const message = await $(failure).parentElement().getText();
    throw new Error(`operation failed: ${message}`);
  }
  const titles = await $$(outputs).map((element) => element.getAttribute("title"));
  return titles.filter((title): title is string => title !== null);
}

export function field(label: string) {
  return $(`//label[span[normalize-space(.)="${label}"]]//*[self::input or self::textarea]`);
}

export async function typeInto(element: Element, text: string) {
  await element.waitForEnabled();
  await element.click();
  await browser.keys([CONTROL_KEY, "a"]);
  await browser.keys([CONTROL_KEY]);
  if (text.length === 0) await browser.keys(BACKSPACE_KEY);
  else await browser.keys(text);
  await browser.waitUntil(async () => (await element.getValue()) === text, { timeoutMsg: `field did not take "${text}"` });
}

export async function fill(label: string, text: string) {
  await typeInto(field(label), text);
}

export async function chooseOption(comboboxLabel: string, optionLabel: string) {
  const combobox = $(`//*[@role="combobox"][@aria-label="${comboboxLabel}" or ancestor::label[span[normalize-space(.)="${comboboxLabel}"]]]`);
  await combobox.waitForClickable();
  await combobox.click();
  const option = $(`//*[@role="listbox"]//*[@role="option"][normalize-space(.)="${optionLabel}"]`);
  await option.waitForClickable();
  await option.click();
  await option.waitForDisplayed({ reverse: true });
}

export async function setSwitch(label: string, on: boolean) {
  const control = $(`//input[@role="switch"][@aria-label="${label}"]`);
  await control.waitForExist();
  if ((await control.isSelected()) !== on) {
    const label = control.$("./ancestor::label[1]");
    await label.waitForDisplayed();
    await label.click();
  }
  await browser.waitUntil(async () => (await control.isSelected()) === on, { timeoutMsg: `switch "${label}" did not turn ${on ? "on" : "off"}` });
}

export async function chooseCard(title: string) {
  const card = $(`//*[@role="radio"][.//*[normalize-space(.)="${title}"]]`);
  await card.waitForClickable();
  await card.click();
  await browser.waitUntil(async () => (await card.getAttribute("aria-checked")) === "true");
}

export async function clickDropArea(title: string) {
  const area = $(`//button[span[normalize-space(.)="${title}"]]`);
  await area.waitForClickable();
  await area.click();
}

export async function runPrimary(label: string) {
  const target = $(`//button[contains(@class,"primary-gradient")][normalize-space(.)="${label}"]`);
  await browser.waitUntil(async () => (await target.isExisting()) && (await target.isEnabled()), { timeout: 60000, timeoutMsg: `"${label}" never became enabled` });
  await target.click();
}
