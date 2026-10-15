import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import i18n from "i18next";
import { SHORTCUT_GROUPS } from "./shortcutGroups";
import { escapeMarkdown, saveShortcutsPdf, shortcutsMarkdown } from "./shortcutsPdf";

const tauri = vi.hoisted(() => ({ save: vi.fn(), invoke: vi.fn() }));

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: tauri.save }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));

describe("shortcut list PDF", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  beforeEach(() => {
    tauri.save.mockReset();
    tauri.invoke.mockReset().mockResolvedValue({ output: "C:/out/shortcuts.pdf" });
  });

  it("writes one table per group with every action and its keys", () => {
    const markdown = shortcutsMarkdown(SHORTCUT_GROUPS, i18n.t);

    expect(markdown).toContain("## Page organizer");
    expect(markdown).toContain("| Invert selection |");
    expect(markdown.match(/^## /gm)).toHaveLength(SHORTCUT_GROUPS.length);
    expect(markdown).not.toMatch(/\{\w+\}/);
  });

  it("escapes characters that would break the table or turn into formatting", () => {
    expect(escapeMarkdown("a | b *c* _d_ [e]")).toBe("a \\| b \\*c\\* \\_d\\_ \\[e\\]");
    const markdown = shortcutsMarkdown([{ id: "global", items: [{ keys: "Ctrl +  /  Ctrl −", labelKey: "about.shortcuts.items.zoom" }] }], i18n.t);

    expect(markdown).toContain("Ctrl\u00a0\\+ / Ctrl\u00a0−");
  });

  it("asks where to save and makes nothing when the dialog is cancelled", async () => {
    tauri.save.mockResolvedValueOnce(null);

    expect(await saveShortcutsPdf(SHORTCUT_GROUPS, i18n.t)).toBeNull();
    expect(tauri.invoke).not.toHaveBeenCalledWith("rpc", expect.anything());
  });
});
