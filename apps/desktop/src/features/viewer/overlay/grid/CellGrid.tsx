import { useState, type ClipboardEvent, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { cn } from "@/shared/lib/cn";
import { gridColumns, parseClipboardGrid, pasteOverflows, type GridEdit, type GridLimits } from "./gridModel";

type CellGridProps = {
  legend: string;
  cells: string[][];
  limits: GridLimits;
  onEdit: (edit: GridEdit) => void;
  headerRow: boolean;
  headerColumn?: boolean;
  fixedColumns?: number;
  columnTools?: (column: number) => ReactNode;
  hint?: string;
  invalid?: (row: number, column: number) => boolean;
  narrow?: boolean;
};

export function CellGrid({ legend, cells, limits, onEdit, headerRow, headerColumn = false, fixedColumns = 0, columnTools, hint, invalid, narrow = false }: CellGridProps) {
  const { t } = useTranslation();
  const [trimmed, setTrimmed] = useState(false);
  const columns = gridColumns(cells);

  const paste = (event: ClipboardEvent<HTMLInputElement>, row: number, column: number) => {
    const grid = parseClipboardGrid(event.clipboardData.getData("text/plain"));
    if (!grid) return;
    event.preventDefault();
    setTrimmed(pasteOverflows(row, column, grid, limits));
    onEdit({ kind: "paste", row, column, grid });
  };

  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-1.5 text-sm font-medium text-foreground/80">{legend}</legend>
      <div className="max-h-64 overflow-auto rounded-lg border">
        <table className="border-separate border-spacing-0">
          <thead>
            <tr>
              {Array.from({ length: columns }, (_, column) => (
                <th key={column} scope="col" className="sticky top-0 z-10 border-b bg-card px-1 py-1 font-normal">
                  <div className="flex items-center justify-center gap-0.5">
                    {columnTools?.(column)}
                    {column >= fixedColumns ? <IconButton icon={Trash2} label={t("viewer.grid.removeColumn", { column: column + 1 })} disabled={columns <= limits.minColumns} onClick={() => onEdit({ kind: "removeColumn", column })} /> : null}
                  </div>
                </th>
              ))}
              <th className="sticky top-0 z-10 border-b bg-card" aria-hidden />
            </tr>
          </thead>
          <tbody>
            {cells.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((text, column) => {
                  const wrong = invalid?.(rowIndex, column) ?? false;
                  return (
                    <td key={column} className="border-b border-e p-0">
                      <input
                        value={text}
                        onChange={(event) => onEdit({ kind: "setCell", row: rowIndex, column, text: event.target.value })}
                        onPaste={(event) => paste(event, rowIndex, column)}
                        aria-label={t("viewer.grid.cellLabel", { row: rowIndex + 1, column: column + 1 })}
                        aria-invalid={wrong || undefined}
                        spellCheck={false}
                        className={cn(
                          "h-row bg-transparent px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                          narrow ? "w-28" : "w-36",
                          ((headerRow && rowIndex === 0) || (headerColumn && column === 0)) && "bg-secondary font-medium",
                          wrong && "text-destructive ring-1 ring-inset ring-destructive",
                        )}
                      />
                    </td>
                  );
                })}
                <td className="border-b px-1">
                  <IconButton icon={Trash2} label={t("viewer.grid.removeRow", { row: rowIndex + 1 })} disabled={cells.length <= 1} onClick={() => onEdit({ kind: "removeRow", row: rowIndex })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" icon={<Plus className="size-4" aria-hidden />} disabled={cells.length >= limits.rows} onClick={() => onEdit({ kind: "addRow" })}>
          {t("viewer.grid.addRow")}
        </Button>
        <Button size="sm" variant="ghost" icon={<Plus className="size-4" aria-hidden />} disabled={columns >= limits.columns} onClick={() => onEdit({ kind: "addColumn" })}>
          {t("viewer.grid.addColumn")}
        </Button>
        <span className="text-xs text-muted-foreground">{hint ?? t("viewer.grid.pasteHint")}</span>
      </div>
      {trimmed ? (
        <p role="status" className="text-xs text-warning">
          {t("viewer.grid.pasteTrimmed", { rows: limits.rows, columns: limits.columns })}
        </p>
      ) : null}
    </fieldset>
  );
}
