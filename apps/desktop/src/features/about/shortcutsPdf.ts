import type { TFunction } from "i18next";
import { save } from "@tauri-apps/plugin-dialog";
import { createDocument } from "@/shared/rpc/operations";
import { keyCombos, type ShortcutGroup } from "./shortcutGroups";

const NO_BREAK_SPACE = " ";

export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, "\\$&").replace(/\s*\n\s*/g, " ");
}

export function shortcutsMarkdown(groups: ShortcutGroup[], t: TFunction): string {
  const header = `| ${escapeMarkdown(t("shortcutSheet.pdf.action"))} | ${escapeMarkdown(t("shortcutSheet.pdf.keys"))} |\n| --- | --- |`;
  return groups
    .filter((group) => group.items.length > 0)
    .map((group) => {
      const rows = group.items.map((item) => {
        const keys = keyCombos(item.keys, t).map((combo) => escapeMarkdown(combo).replace(/ /g, NO_BREAK_SPACE)).join(" / ");
        return `| ${escapeMarkdown(t(item.labelKey))} | ${keys} |`;
      });
      return [`## ${escapeMarkdown(t(`about.shortcuts.groups.${group.id}`))}`, "", header, ...rows].join("\n");
    })
    .join("\n\n");
}

export async function saveShortcutsPdf(groups: ShortcutGroup[], t: TFunction): Promise<string | null> {
  const output = await save({ defaultPath: `${t("shortcutSheet.pdf.fileName")}.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (!output) return null;
  await createDocument({ text: shortcutsMarkdown(groups, t), format: "markdown", template: "report", title: t("about.tabs.shortcuts"), output, overwrite: true });
  return output;
}
