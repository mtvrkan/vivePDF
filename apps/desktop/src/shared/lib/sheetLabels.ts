export type SheetLabels = { pageLabel: string; tableLabel: string; textLabel: string };

export function sheetLabels(translate: (key: string) => string): SheetLabels {
  return {
    pageLabel: translate("tools.convert.sheetLabels.page"),
    tableLabel: translate("tools.convert.sheetLabels.table"),
    textLabel: translate("tools.convert.sheetLabels.text"),
  };
}
