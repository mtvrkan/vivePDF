import { useTranslation } from "react-i18next";
import { LayoutGrid } from "lucide-react";
import { OutputPathField } from "@/components/tool/OutputPathField";
import { ResultPanel } from "@/components/tool/ResultPanel";
import type { useOperation } from "@/shared/hooks/useOperation";
import { formatNumber } from "@/shared/lib/format";
import { useUiStore } from "@/shared/store/uiStore";
import type { AssembleParams, AssemblePartsParams, AssemblePartsResult, OutputResult } from "@/types";

type SingleOperation = ReturnType<typeof useOperation<AssembleParams, OutputResult>>;
type PartsOperation = ReturnType<typeof useOperation<AssemblePartsParams, AssemblePartsResult>>;

type OrganizerOutputProps = {
  output: string;
  onOutputChange: (output: string) => void;
  busy: boolean;
  resultKind: "single" | "parts";
  operation: SingleOperation;
  partsOperation: PartsOperation;
  sourcePassword: string | undefined;
  onRetrySingle: () => void;
  onRetryParts: () => void;
};

export function OrganizerOutput({ output, onOutputChange, busy, resultKind, operation, partsOperation, sourcePassword, onRetrySingle, onRetryParts }: OrganizerOutputProps) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  return (
    <div className="glass-flat flex min-h-0 flex-col">
      <div className="border-b p-4">
        <OutputPathField value={output} onChange={onOutputChange} disabled={busy} />
      </div>
      <div className="min-h-0 flex-1">
        {resultKind === "parts" ? (
          <ResultPanel
            status={partsOperation.status}
            progress={partsOperation.progress}
            error={partsOperation.error}
            numeral={partsOperation.result ? formatNumber(partsOperation.result.outputs.length, locale) : undefined}
            caption={partsOperation.result ? t("tools.split.parts") : undefined}
            outputs={partsOperation.result ? partsOperation.result.outputs.map((part) => part.output) : []}
            sourcePassword={sourcePassword}
            idleIcon={LayoutGrid}
            idleTitle={t("tools.pages.idle.title")}
            idleDescription={t("tools.pages.idle.description")}
            onCancel={partsOperation.cancel}
            onRetry={onRetryParts}
            overwritePrompt={partsOperation.overwritePrompt}
            onConfirmOverwrite={partsOperation.confirmOverwrite}
            onDismissOverwrite={partsOperation.dismissOverwrite}
          />
        ) : (
          <ResultPanel
            status={operation.status}
            progress={operation.progress}
            error={operation.error}
            numeral={operation.result ? formatNumber(operation.result.pageCount, locale) : undefined}
            caption={operation.result ? t("info.pages") : undefined}
            outputs={operation.result ? [operation.result.output] : []}
            sourcePassword={sourcePassword}
            idleIcon={LayoutGrid}
            idleTitle={t("tools.pages.idle.title")}
            idleDescription={t("tools.pages.idle.description")}
            onCancel={operation.cancel}
            onRetry={onRetrySingle}
            overwritePrompt={operation.overwritePrompt}
            onConfirmOverwrite={operation.confirmOverwrite}
            onDismissOverwrite={operation.dismissOverwrite}
          />
        )}
      </div>
    </div>
  );
}
