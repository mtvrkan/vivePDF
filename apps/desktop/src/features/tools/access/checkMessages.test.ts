import { describe, expect, it } from "vitest";

(globalThis as unknown as { localStorage: { getItem: () => null; setItem: () => void; removeItem: () => void } }).localStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};
(globalThis as unknown as { document: { documentElement: { lang: string; dir: string } } }).document = {
  documentElement: { lang: "", dir: "" },
};

const { default: i18n, ready, setLocale } = await import("@/app/i18n");

describe("accessibility heading messages", () => {
  it("explains a missing heading structure instead of reporting skipped levels", async () => {
    await ready();
    await setLocale("en");
    expect(i18n.t("tools.access.checks.headings.warn", { count: 0 })).toBe("No headings. They let screen-reader users jump through the document; a short document may not need any.");
    expect(i18n.t("tools.access.checks.headings.warn", { count: 3 })).toBe("3 headings, but levels are skipped.");
    await setLocale("tr");
    expect(i18n.t("tools.access.checks.headings.warn", { count: 0 })).toBe("Başlık yok. Başlıklar ekran okuyucu kullananların belgede gezinmesini sağlar; kısa bir belgede gerekmeyebilir.");
  });
});
