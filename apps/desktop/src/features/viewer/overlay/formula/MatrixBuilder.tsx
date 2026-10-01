import { useId, useState } from "react";
import { Grid3x3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Select } from "@/components/shared/Select";
import { TextInput } from "@/components/tool/form";
import { clampMatrixSize, MATRIX_BRACKETS, MATRIX_FILLS, MAX_MATRIX_SIZE, matrixLatex, type MatrixBracket, type MatrixFill } from "./matrix";

export function MatrixBuilder({ onInsert }: { onInsert: (latex: string) => void }) {
  const { t } = useTranslation();
  const rowsId = useId();
  const columnsId = useId();
  const [rows, setRows] = useState("2");
  const [columns, setColumns] = useState("2");
  const [bracket, setBracket] = useState<MatrixBracket>("bracket");
  const [fill, setFill] = useState<MatrixFill>("entries");

  const insert = () => onInsert(matrixLatex({ rows: clampMatrixSize(Number(rows)), columns: clampMatrixSize(Number(columns)), bracket, fill, letter: "a" }));

  return (
    <fieldset className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium text-foreground/80">{t("viewer.formula.matrix.title")}</legend>
      <label htmlFor={rowsId} className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t("viewer.formula.matrix.rows")}</span>
        <TextInput id={rowsId} type="number" min={1} max={MAX_MATRIX_SIZE} value={rows} onChange={(event) => setRows(event.target.value)} onBlur={() => setRows(String(clampMatrixSize(Number(rows))))} className="h-9 w-16 font-mono" />
      </label>
      <span className="pb-2 text-sm text-muted-foreground" aria-hidden>
        ×
      </span>
      <label htmlFor={columnsId} className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t("viewer.formula.matrix.columns")}</span>
        <TextInput id={columnsId} type="number" min={1} max={MAX_MATRIX_SIZE} value={columns} onChange={(event) => setColumns(event.target.value)} onBlur={() => setColumns(String(clampMatrixSize(Number(columns))))} className="h-9 w-16 font-mono" />
      </label>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground" aria-hidden>
          {t("viewer.formula.matrix.bracket")}
        </span>
        <Select size="sm" value={bracket} options={MATRIX_BRACKETS.map((value) => ({ value, label: t(`viewer.formula.matrix.brackets.${value}`) }))} onChange={(value) => setBracket(value as MatrixBracket)} ariaLabel={t("viewer.formula.matrix.bracket")} className="w-44" />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground" aria-hidden>
          {t("viewer.formula.matrix.fill")}
        </span>
        <Select size="sm" value={fill} options={MATRIX_FILLS.map((value) => ({ value, label: t(`viewer.formula.matrix.fills.${value}`) }))} onChange={(value) => setFill(value as MatrixFill)} ariaLabel={t("viewer.formula.matrix.fill")} className="w-40" />
      </div>
      <Button size="sm" icon={<Grid3x3 className="size-4" aria-hidden />} onClick={insert}>
        {t("viewer.formula.matrix.insert")}
      </Button>
    </fieldset>
  );
}
