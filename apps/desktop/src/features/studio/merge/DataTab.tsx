import { useMemo } from "react";
import { ChevronLeft, ChevronRight, FileSpreadsheet, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { FileDropArea } from "@/components/tool/FileDropArea";
import { Checkbox, Field, SelectInput } from "@/components/tool/form";
import { describeError } from "@/shared/lib/errorMessage";
import { basenameOf } from "@/shared/lib/paths";
import { BULK_DATA_EXTENSIONS } from "@/features/tools/create/createDocument";
import { BUILTIN_PLACEHOLDERS, placeholdersIn } from "../model/design";
import { useStudioStore } from "../design/studioStore";
import { useMergeStore } from "./mergeStore";
import { insertPlaceholder, placeholderToken } from "./placeholders";

function Chip({ name, label }: { name: string; label?: string }) {
  const { t } = useTranslation();
  const token = placeholderToken(name);
  return (
    <button
      type="button"
      data-placeholder={name}
      title={label ?? t("studio.data.insert", { token })}
      aria-label={t("studio.data.insert", { token })}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => insertPlaceholder(name)}
      className="glass-chip max-w-full truncate rounded-full px-2.5 py-1 font-mono text-xs hover:ring-2 hover:ring-primary/40"
    >
      {token}
    </button>
  );
}

export function DataTab() {
  const { t } = useTranslation();
  const design = useStudioStore((state) => state.design);
  const dataPath = useMergeStore((state) => state.dataPath);
  const sheet = useMergeStore((state) => state.sheet);
  const table = useMergeStore((state) => state.table);
  const loading = useMergeStore((state) => state.loading);
  const error = useMergeStore((state) => state.error);
  const row = useMergeStore((state) => state.row);
  const showValues = useMergeStore((state) => state.showValues);
  const { connect, reload, clear, setRow, setShowValues } = useMergeStore.getState();
  const used = useMemo(() => (design ? placeholdersIn(design) : []), [design]);
  const unknown = table ? used.filter((name) => !table.columns.includes(name)) : [];

  const pick = async () => {
    const chosen = await openDialog({ multiple: false, directory: false, title: t("studio.data.pick"), filters: [{ name: t("studio.data.files"), extensions: BULK_DATA_EXTENSIONS }] });
    if (typeof chosen === "string") await connect(chosen);
  };

  if (!dataPath) {
    return (
      <div className="space-y-4 p-4">
        <FileDropArea title={t("studio.data.pick")} description={t("studio.data.pickDescription")} icon={FileSpreadsheet} onPick={() => void pick()} />
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("studio.data.builtins")}</h3>
          <div className="flex flex-wrap gap-1.5">
            {BUILTIN_PLACEHOLDERS.map((name) => (
              <Chip key={name} name={name} label={t(`studio.data.builtin.${name}`)} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t("studio.data.builtinsHint")}</p>
        </section>
      </div>
    );
  }

  const rowCount = table?.rows.length ?? 0;
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm">
        <FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate" title={dataPath} data-testid="studio-data-file">
          {basenameOf(dataPath)}
        </span>
        <IconButton icon={RefreshCw} label={t("studio.data.reload")} disabled={loading} onClick={() => void reload()} />
        <IconButton icon={X} label={t("studio.data.remove")} onClick={clear} />
      </div>
      <Button size="sm" variant="ghost" onClick={() => void pick()} className="w-full">
        {t("studio.data.change")}
      </Button>
      {loading ? (
        <div role="status" aria-label={t("studio.data.reading")} className="flex flex-wrap gap-2">
          <div className="h-6 w-20 animate-pulse rounded-full bg-secondary/70" />
          <div className="h-6 w-24 animate-pulse rounded-full bg-secondary/70" />
          <div className="h-6 w-16 animate-pulse rounded-full bg-secondary/70" />
        </div>
      ) : null}
      {error && !loading ? (
        <p role="alert" className="text-sm text-destructive">
          {describeError(t, error)}
        </p>
      ) : null}
      {table && !loading ? (
        <>
          <p className="text-xs text-muted-foreground" data-testid="studio-data-rows">
            {t("studio.data.rows", { count: table.totalRows })}
          </p>
          {table.sheets.length > 1 ? (
            <Field label={t("studio.data.sheet")}>
              <SelectInput value={sheet ?? table.sheets[0]} onChange={(event) => void connect(dataPath, event.target.value)} aria-label={t("studio.data.sheet")}>
                {table.sheets.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </SelectInput>
            </Field>
          ) : null}
          {table.totalRows === 0 ? <p className="text-sm text-warning">{t("studio.data.noRows")}</p> : null}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("studio.data.columns")}</h3>
            {table.columns.length ? (
              <div className="flex flex-wrap gap-1.5">
                {table.columns.map((name) => (
                  <Chip key={name} name={name} />
                ))}
                {BUILTIN_PLACEHOLDERS.map((name) => (
                  <Chip key={name} name={name} label={t(`studio.data.builtin.${name}`)} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("studio.data.noColumns")}</p>
            )}
            <p className="text-xs text-muted-foreground">{t("studio.data.columnsHint")}</p>
          </section>
          {unknown.length ? (
            <p role="status" className="text-sm text-warning">
              {t("studio.data.unknown", { names: unknown.map(placeholderToken).join(", ") })}
            </p>
          ) : null}
          {rowCount > 0 ? (
            <section className="space-y-2">
              <Checkbox label={t("studio.data.showValues")} checked={showValues} onChange={setShowValues} />
              <div className="flex items-center gap-1">
                <IconButton icon={ChevronLeft} label={t("studio.data.previous")} disabled={!showValues || row === 0} onClick={() => setRow(row - 1)} />
                <span className="flex-1 text-center text-sm tabular-nums" data-testid="studio-data-row">
                  {t("studio.data.row", { row: row + 1, total: table.totalRows })}
                </span>
                <IconButton icon={ChevronRight} label={t("studio.data.next")} disabled={!showValues || row >= rowCount - 1} onClick={() => setRow(row + 1)} />
              </div>
              {table.totalRows > rowCount ? <p className="text-xs text-muted-foreground">{t("studio.data.previewLimit", { count: rowCount })}</p> : null}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
