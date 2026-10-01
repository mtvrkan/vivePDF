import { memo, useState, type FormEvent } from "react";
import { AlertTriangle, ArrowRight, FileText, RotateCcw, ScanText, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { PasswordInput } from "@/components/shared/PasswordInput";
import { TextInput } from "@/components/tool/form";
import { cn } from "@/shared/lib/cn";
import { basenameOf } from "@/shared/lib/paths";
import type { RenameItem } from "@/types";
import { extensionOf } from "./renameOptions";

const SHOWN_FIELDS = ["date", "invoice", "amount", "title"] as const;

type RenameRowProps = {
  path: string;
  position: number;
  item: RenameItem | undefined;
  override: string | undefined;
  triedPassword: boolean;
  conflictNote: string;
  disabled: boolean;
  onOverride: (path: string, value: string | null) => void;
  onPassword: (path: string, password: string) => void;
  onRemove: (path: string) => void;
};

function PasswordForm({ path, wrong, disabled, onPassword }: { path: string; wrong: boolean; disabled: boolean; onPassword: (path: string, password: string) => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (password) onPassword(path, password);
  };
  return (
    <form onSubmit={submit} className="mt-1.5 flex flex-wrap items-center gap-2">
      <PasswordInput value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t("password.label")} aria-label={t("tools.rename.passwordFor", { name: basenameOf(path) })} disabled={disabled} className="h-8 w-44" />
      <Button size="sm" type="submit" variant="primary" disabled={!password || disabled}>
        {t("password.open")}
      </Button>
      {wrong ? <span className="text-xs text-destructive">{t("password.wrong")}</span> : null}
    </form>
  );
}

export const RenameRow = memo(function RenameRow({ path, position, item, override, triedPassword, conflictNote, disabled, onOverride, onPassword, onRemove }: RenameRowProps) {
  const { t } = useTranslation();
  const name = basenameOf(path);
  const extension = extensionOf(path);
  const locked = item?.error === "NEEDS_PASSWORD";
  return (
    <li className="glass-chip flex min-h-11 items-start gap-3 rounded-xl px-3 py-2 text-sm">
      <span className="mt-2 w-6 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{position + 1}</span>
      <FileText className="mt-2 size-4 shrink-0 text-(--tone)" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 max-w-full truncate text-muted-foreground" title={path}>
            {name}
          </span>
          {item && !item.error ? (
            <>
              <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="flex min-w-48 flex-1 items-center gap-1">
                <TextInput
                  value={override ?? item.newName}
                  onChange={(event) => onOverride(path, event.target.value)}
                  aria-label={t("tools.rename.newNameFor", { name })}
                  aria-invalid={item.conflict || undefined}
                  disabled={disabled}
                  className={cn("h-8 font-medium", item.conflict && "border-warning")}
                />
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{extension}</span>
                {override !== undefined ? <IconButton icon={RotateCcw} label={t("tools.rename.resetName")} disabled={disabled} onClick={() => onOverride(path, null)} /> : null}
              </span>
            </>
          ) : null}
        </div>
        {locked ? (
          <>
            <span className="text-xs text-muted-foreground">{t("errors.NEEDS_PASSWORD")}</span>
            <PasswordForm key={path} path={path} wrong={triedPassword} disabled={disabled} onPassword={onPassword} />
          </>
        ) : item?.error ? (
          <span className="text-xs text-destructive">{t(`errors.${item.error}`, { defaultValue: t("tools.rename.unreadable") })}</span>
        ) : item ? (
          <span className="flex min-w-0 items-center gap-2">
            {item.recognised ? (
              <span className="flex shrink-0 items-center gap-1 rounded bg-(--tone-soft) px-1.5 py-0.5 text-[11px] text-(--tone)">
                <ScanText className="size-3" aria-hidden />
                {t("tools.rename.readWithOcr")}
              </span>
            ) : null}
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {SHOWN_FIELDS.filter((key) => item.fields[key])
                .map((key) => `${t(`tools.rename.tokens.${key}`)}: ${item.fields[key]}`)
                .join(" · ") || t("tools.rename.noFields")}
            </span>
          </span>
        ) : null}
        {item?.conflict ? <span className="text-xs text-warning">{conflictNote}</span> : null}
      </div>
      {item?.conflict ? <AlertTriangle className="mt-2 size-4 shrink-0 text-warning" aria-hidden /> : null}
      <IconButton icon={X} label={t("tools.rename.remove", { name })} disabled={disabled} onClick={() => onRemove(path)} />
    </li>
  );
});
