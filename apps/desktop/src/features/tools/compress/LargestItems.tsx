import { useTranslation } from "react-i18next";
import { formatBytes, formatNumber } from "@/shared/lib/format";
import { useUiStore } from "@/shared/store/uiStore";
import type { SpaceFont, SpaceImage } from "@/types";
import { SHOWN_ITEMS, fontFormatName, imageFormatName, pageList } from "./largestItemFormat";

export function LargestItems({ images, fonts }: { images: SpaceImage[]; fonts: SpaceFont[] }) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const number = (value: number) => formatNumber(value, locale);

  const imageDetail = (image: SpaceImage) => {
    const format = imageFormatName(image.format);
    return [
      t("tools.compress.largest.pixels", { width: number(image.width), height: number(image.height) }),
      "name" in format ? format.name : t(format.key),
      image.dpi ? t("tools.compress.largest.dpi", { dpi: number(image.dpi) }) : "",
      image.pages.length ? t("tools.compress.largest.onPages", { count: image.pages.length, pages: pageList(image.pages, number) }) : t("tools.compress.largest.unused"),
    ]
      .filter(Boolean)
      .join(" · ");
  };

  const fontDetail = (font: SpaceFont) => [fontFormatName(font.format), font.subset ? t("tools.compress.largest.subset") : t("tools.compress.largest.whole")].join(" · ");

  const lists = [
    { key: "images", title: t("tools.compress.largest.images"), rows: images.slice(0, SHOWN_ITEMS).map((image) => ({ id: image.xref, name: imageDetail(image), bytes: image.bytes, detail: "" })) },
    { key: "fonts", title: t("tools.compress.largest.fonts"), rows: fonts.slice(0, SHOWN_ITEMS).map((font) => ({ id: font.xref, name: font.name || t("tools.compress.largest.unnamed"), bytes: font.bytes, detail: fontDetail(font) })) },
  ].filter((list) => list.rows.length > 0);

  if (lists.length === 0) return null;

  return (
    <div className="grid gap-3">
      {lists.map((list) => (
        <div key={list.key}>
          <h3 className="mb-1.5 text-xs font-medium text-foreground/80">{list.title}</h3>
          <ul className="rounded-lg border text-xs">
            {list.rows.map((row) => (
              <li key={row.id} className="flex items-start justify-between gap-3 border-b px-3 py-2 last:border-b-0">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="break-words text-foreground/90">{row.name}</span>
                  {row.detail ? <span className="text-muted-foreground">{row.detail}</span> : null}
                </span>
                <span className="shrink-0 font-mono tabular-nums text-muted-foreground">{formatBytes(row.bytes, locale)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {fonts.some((font) => !font.subset) ? <p className="text-xs text-muted-foreground">{t("tools.compress.largest.wholeHint")}</p> : null}
    </div>
  );
}
