import { existsSync } from "node:fs";
import { join } from "node:path";
import { $, browser, expect } from "@wdio/globals";
import {
  answerDialogs,
  bootApp,
  chooseSource,
  clickButton,
  copyFixture,
  fill,
  fixtures,
  openTool,
  outputPath,
  probe,
  runPrimary,
  t,
  typeInto,
  waitForDialogsAnswered,
  waitForOutputs,
  workDir,
} from "../support/app.ts";

const PASSWORD = "Gizli-Şifre-2026";

function sectionField(sectionTitle: string, label: string) {
  return $(`//section[.//*[normalize-space(text())="${sectionTitle}"]]//label[span[normalize-space(.)="${label}"]]//input`);
}

describe("security", () => {
  before(bootApp);

  it("adds a password and removes it again", async () => {
    const source = copyFixture(fixtures().sample, "secret.pdf");
    await openTool("tools.security.encrypt.title");
    await chooseSource(source);
    await typeInto(sectionField(t("tools.security.encrypt.title"), t("tools.security.encrypt.userPassword")), PASSWORD);
    await typeInto(sectionField(t("tools.security.encrypt.title"), t("password.confirm")), PASSWORD);
    const expected = await outputPath();
    await runPrimary(t("tools.security.encrypt.run"));
    const [locked] = await waitForOutputs();
    expect(locked).toBe(expected);
    const lockedProbe = probe(locked);
    expect(lockedProbe.encrypted).toBe(true);
    expect(lockedProbe.unlocked).toBe(false);
    expect(probe(locked, PASSWORD).pageCount).toBe(3);

    await openTool("tools.security.decrypt.title");
    await chooseSource(locked, { locked: true });
    await typeInto(sectionField(t("tools.security.decrypt.title"), t("password.label")), PASSWORD);
    await runPrimary(t("tools.security.decrypt.run"));
    const [unlocked] = await waitForOutputs();
    const unlockedProbe = probe(unlocked);
    expect(unlockedProbe.encrypted).toBe(false);
    expect(unlockedProbe.pageCount).toBe(3);
    expect(unlockedProbe.pages?.[2].text).toContain("Sample page 3");
  });

  it("stamps a text watermark on every page", async () => {
    const source = copyFixture(fixtures().sample, "watermark.pdf");
    await openTool("tools.security.watermark.title");
    await chooseSource(source);
    await fill(t("tools.security.watermark.text"), "TASLAK ŞİRKET");
    const expected = await outputPath();
    await runPrimary(t("tools.security.watermark.run"));
    const [output] = await waitForOutputs();
    expect(output).toBe(expected);
    const result = probe(output);
    expect(result.pageCount).toBe(3);
    for (const page of result.pages ?? []) {
      expect(page.text).toContain("TASLAK ŞİRKET");
    }
    expect(probe(source).pages?.[0].text).not.toContain("TASLAK");
  });

  it("creates a certificate and signs a document with it", async () => {
    const certificate = join(workDir(), "e2e-signer.p12");
    await openTool("tools.sign.certificate.title");
    await fill(t("tools.sign.certificate.commonName"), "E2E Test İmzacı");
    await fill(t("tools.sign.certificate.password"), PASSWORD);
    answerDialogs(certificate);
    await clickButton(t("tools.browse"));
    await waitForDialogsAnswered();
    await runPrimary(t("tools.sign.certificate.run"));
    await browser.waitUntil(() => existsSync(certificate), { timeout: 60000, timeoutMsg: "certificate was never written" });

    const source = copyFixture(fixtures().sample, "sign-me.pdf");
    await openTool("tools.sign.sign.title");
    await chooseSource(source);
    answerDialogs(certificate);
    await $(`//label[span[normalize-space(.)="${t("tools.sign.sign.certificateFile")}"]]//button`).click();
    await waitForDialogsAnswered();
    await fill(t("tools.sign.sign.certificatePassword"), PASSWORD);
    const expected = await outputPath();
    await runPrimary(t("tools.sign.sign.run"));
    const [signed] = await waitForOutputs();
    expect(signed).toBe(expected);
    const result = probe(signed);
    expect(result.pageCount).toBe(3);
    expect(result.signatureFields).toBeGreaterThanOrEqual(1);
    expect(result.signatures).toHaveLength(1);
    expect(result.signatures?.[0].intact).toBe(true);
    expect(result.signatures?.[0].coverage).toBe("ENTIRE_FILE");
  });
});
