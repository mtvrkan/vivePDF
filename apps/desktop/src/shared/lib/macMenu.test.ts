import { describe, expect, it } from "vitest";
import { buildMacMenu, keyCode, parseMenuCommand, type MenuNode } from "./macMenu";

const t = ((key: string) => key) as unknown as Parameters<typeof buildMacMenu>[0];

function ids(nodes: MenuNode[]): string[] {
  return nodes.flatMap((node) => (node.kind === "item" ? [node.id] : node.kind === "submenu" ? ids(node.items) : []));
}

describe("macMenu", () => {
  it("builds the standard mac menus with the app's own commands", () => {
    const menu = buildMacMenu(t);
    expect(menu.map((node) => (node.kind === "submenu" ? node.label : node.kind))).toEqual(["vivePDF", "appMenu.file", "appMenu.edit", "appMenu.view", "appMenu.go", "appMenu.window", "nav.help"]);
    const all = ids(menu);
    expect(all).toContain("app:quit");
    expect(all).toContain("key:o");
    expect(all).toContain("key:shift+s");
    expect(all).toContain("nav:/tools/merge");
    expect(new Set(all.filter((id) => id.startsWith("key:"))).size).toBe(all.filter((id) => id.startsWith("key:")).length);
    for (const id of all) expect(id === "app:quit" || parseMenuCommand(id) !== null).toBe(true);
  });

  it("parses menu commands", () => {
    expect(parseMenuCommand("nav:/about?tab=shortcuts")).toEqual({ type: "navigate", route: "/about?tab=shortcuts" });
    expect(parseMenuCommand("key:shift+n")).toEqual({ type: "key", key: "n", shiftKey: true });
    expect(parseMenuCommand("key:=")).toEqual({ type: "key", key: "=", shiftKey: false });
    expect(parseMenuCommand("theme:dark")).toEqual({ type: "theme", mode: "dark" });
    expect(parseMenuCommand("action:reportBug")).toEqual({ type: "action", name: "reportBug" });
    expect(parseMenuCommand("theme:neon")).toBeNull();
    expect(parseMenuCommand("nav:https://example.com")).toBeNull();
    expect(parseMenuCommand("key:enter")).toBeNull();
    expect(parseMenuCommand("bogus")).toBeNull();
  });

  it("maps keys to keyboard codes", () => {
    expect(keyCode("o")).toBe("KeyO");
    expect(keyCode("0")).toBe("Digit0");
    expect(keyCode("=")).toBe("Equal");
    expect(keyCode("-")).toBe("Minus");
  });
});
