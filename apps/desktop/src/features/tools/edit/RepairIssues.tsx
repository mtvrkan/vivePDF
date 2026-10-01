import { useTranslation } from "react-i18next";
import { useOpenPdf } from "@/features/viewer/useOpenPdf";
import { useViewerJumpStore } from "@/shared/store/viewerJumpStore";
import type { RepairResult } from "@/types";
import { canOpenIssuePage, groupIssues } from "./repairReport";

export function RepairIssues({ result }: { result: RepairResult }) {
  const { t } = useTranslation();
  const { openPath } = useOpenPdf();
  const groups = groupIssues(result.issues);
  if (groups.length === 0) return null;

  const openPage = (page: number) => {
    useViewerJumpStore.getState().request({ path: result.output, page });
    void openPath(result.output);
  };

  return (
    <section className="border-b px-4 py-3" aria-labelledby="repair-issues-title">
      <h3 id="repair-issues-title" className="text-sm font-medium">
        {t("tools.edit.repair.issues.title")}
      </h3>
      <dl className="mt-2 flex flex-col gap-2.5">
        {groups.map((group) => {
          const openable = canOpenIssuePage(result, group.kind);
          return (
            <div key={group.kind}>
              <dt className="text-xs text-muted-foreground">{t(`tools.edit.repair.issues.${group.kind}`, { count: group.pages.length })}</dt>
              <dd className="mt-1 flex max-h-32 flex-wrap gap-1 overflow-y-auto">
                {group.pages.map((page) =>
                  openable ? (
                    <button
                      key={page}
                      type="button"
                      onClick={() => openPage(page)}
                      aria-label={t("tools.edit.repair.issues.openPage", { n: page })}
                      className="glass-chip rounded-md px-2 py-0.5 font-mono text-xs text-foreground outline-none transition-colors hover:bg-(--hover-bg) focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {page}
                    </button>
                  ) : (
                    <span key={page} className="glass-chip rounded-md px-2 py-0.5 font-mono text-xs text-muted-foreground">
                      {page}
                    </span>
                  ),
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      {result.issuesTruncated ? <p className="mt-2 text-xs text-muted-foreground">{t("tools.edit.repair.issues.truncated")}</p> : null}
    </section>
  );
}
