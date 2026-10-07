import { useId, useState } from "react";
import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { PasswordInput } from "@/components/shared/PasswordInput";

type SplitPasswordFormProps = { name: string; wrong: boolean; onSubmit: (password: string) => void };

export function SplitPasswordForm({ name, wrong, onSubmit }: SplitPasswordFormProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const inputId = useId();
  const errorId = useId();

  return (
    <form
      className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
      onSubmit={(event) => {
        event.preventDefault();
        if (value) onSubmit(value);
      }}
    >
      <Lock className="size-8 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium">{t("password.title")}</p>
      <p className="max-w-xs text-xs text-muted-foreground">{t("password.description", { name })}</p>
      <div className="flex w-full max-w-xs flex-col gap-1 text-start">
        <label htmlFor={inputId} className="text-xs text-muted-foreground">
          {t("password.label")}
        </label>
        <PasswordInput
          id={inputId}
          value={value}
          autoFocus
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={wrong || undefined}
          aria-describedby={wrong ? errorId : undefined}
          className="h-8 min-w-0 flex-1"
        />
        {wrong ? (
          <p id={errorId} role="alert" className="text-xs text-destructive">
            {t("password.wrong")}
          </p>
        ) : null}
      </div>
      <Button type="submit" size="sm" variant="primary" disabled={!value}>
        {t("password.open")}
      </Button>
    </form>
  );
}
