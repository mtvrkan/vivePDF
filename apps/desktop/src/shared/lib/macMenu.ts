import type { TFunction } from "i18next";
import { headerNavigation, menuItemsForGroup, type ToolGroup } from "@/app/navigation";

export type MenuNode =
  | { kind: "item"; id: string; label: string; accelerator?: string }
  | { kind: "separator" }
  | { kind: "predefined"; role: string; label?: string }
  | { kind: "submenu"; label: string; items: MenuNode[] };

export type MenuCommand =
  | { type: "navigate"; route: string }
  | { type: "key"; key: string; shiftKey: boolean }
  | { type: "action"; name: string }
  | { type: "theme"; mode: "light" | "dark" | "system" };

const TOOL_GROUPS: ToolGroup[] = ["organize", "fromPdf", "improve", "toPdf", "edit", "security"];
const separator: MenuNode = { kind: "separator" };

function shortcut(key: string, label: string, shift = false): MenuNode {
  const accelerator = `CmdOrCtrl+${shift ? "Shift+" : ""}${key.toUpperCase()}`;
  return { kind: "item", id: `key:${shift ? "shift+" : ""}${key}`, label, accelerator };
}

function link(route: string, label: string, accelerator?: string): MenuNode {
  return { kind: "item", id: `nav:${route}`, label, ...(accelerator ? { accelerator } : {}) };
}

function role(name: string, label: string): MenuNode {
  return { kind: "predefined", role: name, label };
}

export function buildMacMenu(t: TFunction): MenuNode[] {
  const tools = TOOL_GROUPS.flatMap((group): MenuNode[] => {
    const items = menuItemsForGroup(group);
    return items.length ? [{ kind: "submenu", label: t(`tools.grid.groups.${group}`), items: items.map((item) => link(item.route, t(item.labelKey))) }] : [];
  });
  return [
    {
      kind: "submenu",
      label: "vivePDF",
      items: [
        link("/about", t("appMenu.about")),
        separator,
        link("/settings", t("appMenu.settings"), "CmdOrCtrl+,"),
        { kind: "item", id: "action:checkUpdates", label: t("palette.action.checkUpdates") },
        separator,
        role("services", t("appMenu.services")),
        separator,
        role("hide", t("appMenu.hide")),
        role("hideOthers", t("appMenu.hideOthers")),
        role("showAll", t("appMenu.showAll")),
        separator,
        { kind: "item", id: "app:quit", label: t("appMenu.quit"), accelerator: "CmdOrCtrl+Q" },
      ],
    },
    {
      kind: "submenu",
      label: t("appMenu.file"),
      items: [
        shortcut("o", t("palette.action.open")),
        shortcut("n", t("palette.action.newWindow"), true),
        shortcut("v", t("palette.action.clipboard"), true),
        separator,
        shortcut("s", t("appMenu.save")),
        shortcut("s", t("appMenu.saveAs"), true),
        separator,
        shortcut("p", t("appMenu.print")),
        separator,
        shortcut("w", t("common.close")),
      ],
    },
    {
      kind: "submenu",
      label: t("appMenu.edit"),
      items: [
        role("undo", t("appMenu.undo")),
        role("redo", t("appMenu.redo")),
        separator,
        role("cut", t("appMenu.cut")),
        role("copy", t("appMenu.copy")),
        role("paste", t("appMenu.paste")),
        role("selectAll", t("appMenu.selectAll")),
        separator,
        shortcut("f", t("appMenu.find")),
      ],
    },
    {
      kind: "submenu",
      label: t("appMenu.view"),
      items: [
        shortcut("k", t("palette.title")),
        separator,
        shortcut("=", t("viewer.zoomIn")),
        shortcut("-", t("viewer.zoomOut")),
        shortcut("0", t("appMenu.actualSize")),
        separator,
        { kind: "item", id: "theme:light", label: t("palette.action.themeLight") },
        { kind: "item", id: "theme:dark", label: t("palette.action.themeDark") },
        { kind: "item", id: "theme:system", label: t("palette.action.themeSystem") },
        separator,
        role("fullscreen", t("appMenu.enterFullScreen")),
      ],
    },
    {
      kind: "submenu",
      label: t("appMenu.go"),
      items: [...headerNavigation.map((item) => link(item.route, t(item.labelKey))), separator, { kind: "submenu", label: t("nav.tools"), items: tools }],
    },
    {
      kind: "submenu",
      label: t("appMenu.window"),
      items: [role("minimize", t("appMenu.minimize")), role("zoom", t("appMenu.zoom"))],
    },
    {
      kind: "submenu",
      label: t("nav.help"),
      items: [
        link("/about?tab=shortcuts", t("about.tabs.shortcuts")),
        link("/about?tab=privacy", t("about.tabs.privacy")),
        separator,
        { kind: "item", id: "action:reportBug", label: t("palette.action.reportBug") },
        { kind: "item", id: "action:suggestFeature", label: t("palette.action.suggestFeature") },
        { kind: "item", id: "action:openLogDir", label: t("palette.action.openLogDir") },
      ],
    },
  ];
}

export function parseMenuCommand(id: string): MenuCommand | null {
  const [prefix, ...rest] = id.split(":");
  const value = rest.join(":");
  if (!value) return null;
  if (prefix === "nav" && value.startsWith("/")) return { type: "navigate", route: value };
  if (prefix === "action") return { type: "action", name: value };
  if (prefix === "theme" && (value === "light" || value === "dark" || value === "system")) return { type: "theme", mode: value };
  if (prefix === "key") {
    const shiftKey = value.startsWith("shift+");
    const key = shiftKey ? value.slice("shift+".length) : value;
    return key.length === 1 ? { type: "key", key, shiftKey } : null;
  }
  return null;
}

const KEY_CODES: Record<string, string> = { "=": "Equal", "-": "Minus", ",": "Comma" };

export function keyCode(key: string): string {
  if (KEY_CODES[key]) return KEY_CODES[key];
  return /\d/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`;
}
