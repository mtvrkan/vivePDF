import { useTranslation } from "react-i18next";
import {
  formatBytes,
  formatNumber,
  formatPageSize,
  formatPdfDate,
  pageSizesAreUniform,
} from "@/shared/lib/format";
import { useUiStore } from "@/shared/store/uiStore";
import type { DocumentInfo } from "@/types";

const METADATA_KEYS = ["title", "author", "subject", "creator", "producer", "creationDate", "modDate"] as const;
const DATE_KEYS = new Set<string>(["creationDate", "modDate"]);

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex h-row items-center justify-between gap-4 border-b text-sm last:border-b-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-end tabular-nums" title={value}>
        {value}
      </dd>
    </div>
  );
}

export function DocumentInfoCard({ info }: { info: DocumentInfo }) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const yes = t("common.yes");
  const no = t("common.no");
  const pageSize =
    info.pageSizes.length === 0
      ? "—"
      : pageSizesAreUniform(info.pageSizes)
        ? formatPageSize(info.pageSizes[0])
        : t("info.mixedSizes");
  const metadata = METADATA_KEYS.filter((key) => info.metadata[key]);

  return (
    <article className="rounded-md border bg-card">
      <header className="border-b px-4 pb-3 pt-4">
        <p className="text-display font-semibold tabular-nums tracking-tight">
          {formatNumber(info.pageCount, locale)}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("info.pages")} · {formatBytes(info.bytes, locale)}
        </p>
        <p className="mt-2 truncate text-base font-medium" title={info.path}>
          {info.fileName}
        </p>
      </header>
      <dl className="px-4">
        <Row label={t("info.size")} value={formatBytes(info.bytes, locale)} />
        <Row label={t("info.version")} value={info.pdfVersion ?? "—"} />
        <Row label={t("info.pageSize")} value={pageSize} />
        <Row label={t("info.encrypted")} value={info.encrypted ? yes : no} />
        <Row label={t("info.toc")} value={info.hasToc ? yes : no} />
        <Row label={t("info.forms")} value={info.hasForms ? yes : no} />
        <Row label={t("info.attachments")} value={info.hasAttachments ? yes : no} />
      </dl>
      {metadata.length > 0 ? (
        <>
          <p className="border-t px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {t("info.metadata")}
          </p>
          <dl className="px-4 pb-2">
            {metadata.map((key) => (
              <Row
                key={key}
                label={t(`info.${key}`)}
                value={DATE_KEYS.has(key) ? formatPdfDate(info.metadata[key], locale) : info.metadata[key]}
              />
            ))}
          </dl>
        </>
      ) : null}
    </article>
  );
}
