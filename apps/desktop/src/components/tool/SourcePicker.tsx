import { useState, type FormEvent } from "react";
import { FileText, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { formatBytes } from "@/shared/lib/format";
import { cn } from "@/shared/lib/cn";
import { useDropTargetStore } from "@/shared/store/dropTargetStore";
import { useUiStore } from "@/shared/store/uiStore";
import type { AsyncStatus, RpcError, SourceDocument } from "@/types";
import { FileDropArea } from "./FileDropArea";
import { SealedFileAction } from "./SealedFileAction";
import { TextInput } from "./form";
import { describeError } from "@/shared/lib/errorMessage";
import { RepairFileAction } from "@/components/tool/RepairFileAction";

type SourcePickerProps = {
  source: SourceDocument | null;
  status: AsyncStatus;
  error: RpcError | null;
  needsPassword: boolean;
  onPick: () => void;
  onPassword: (password: string) => void;
  disabled?: boolean;
};

export function SourcePicker({ source, status, error, needsPassword, onPick, onPassword, disabled }: SourcePickerProps) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const [password, setPassword] = useState("");
  const dragging = useDropTargetStore((state) => state.dragging);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (password) onPassword(password);
  };

  if (!source && status !== "error") {
    return (
      <FileDropArea
        title={t("tools.chooseSource")}
        description={status === "loading" ? t("common.loading") : t("tools.dropHint")}
        onPick={onPick}
        disabled={disabled || status === "loading"}
      />
    );
  }

  return (
    <div className={cn("card overflow-hidden transition-[box-shadow] duration-(--transition-fast)", dragging && "ring-2 ring-primary/70")}>
      <div className="flex h-11 items-center gap-3 px-4">
        <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm" title={source?.path}>
          {source ? source.fileName : t("tools.noSource")}
          {dragging ? <span className="ms-2 text-xs font-semibold text-primary">{t("tools.dropZone.single")}</span> : source ? null : <span className="ms-2 text-xs text-muted-foreground">{t("tools.dropHint")}</span>}
        </span>
        {source?.info ? (
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            {source.info.pageCount} {t("info.pages")} · {formatBytes(source.info.bytes, locale)}
          </span>
        ) : status === "loading" ? (
          <span className="font-mono text-xs text-muted-foreground">{t("common.loading")}</span>
        ) : null}
        <Button size="sm" icon={<FolderOpen className="size-4" aria-hidden />} onClick={onPick} disabled={disabled}>
          {source ? t("tools.changeSource") : t("tools.chooseSource")}
        </Button>
      </div>
      {status === "error" && error ? (
        <div className="border-t px-3 py-2">
          {needsPassword ? (
            <form onSubmit={submit} className="flex items-center gap-2">
              <TextInput
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t("password.label")}
                aria-label={t("password.label")}
                className="h-7 max-w-xs text-sm"
              />
              <Button size="sm" type="submit" variant="primary" disabled={!password}>
                {t("password.open")}
              </Button>
              {error.data?.wrongPassword ? <span className="text-xs text-destructive">{t("password.wrong")}</span> : null}
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <p role="alert" className="min-w-0 flex-1 text-sm text-destructive">
                {describeError(t, error)}
              </p>
              <SealedFileAction error={error} path={source?.path} />
              <RepairFileAction error={error} path={source?.path} />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
