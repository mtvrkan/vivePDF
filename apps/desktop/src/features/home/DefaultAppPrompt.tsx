import { useState } from "react";
import { FileCheck2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { useDefaultPdfApp } from "@/shared/hooks/useDefaultPdfApp";

export const DEFAULT_APP_PROMPT_KEY = "vivepdf.defaultAppPromptDismissed";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DEFAULT_APP_PROMPT_KEY) === "1";
  } catch {
    return false;
  }
}

export function DefaultAppPrompt() {
  const { t } = useTranslation();
  const { status, busy, makeDefault } = useDefaultPdfApp();
  const [dismissed, setDismissed] = useState(readDismissed);

  if (dismissed || !status?.supported || status.isDefault) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DEFAULT_APP_PROMPT_KEY, "1");
    } catch {
      return;
    }
  };

  return (
    <section className="glass glass-tinted flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl px-5 py-4" data-tone="organize" aria-labelledby="default-app-prompt-title">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <FileCheck2 className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 basis-64">
        <p id="default-app-prompt-title" className="text-sm font-semibold text-foreground">{t("defaultApp.prompt.title")}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{status.current ? t("defaultApp.prompt.body", { name: status.current }) : t("defaultApp.prompt.bodyNone")}</p>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" icon={<X className="size-3.5" aria-hidden />} onClick={dismiss} disabled={busy} className="rounded-full text-muted-foreground">
          {t("defaultApp.prompt.dismiss")}
        </Button>
        <Button size="sm" variant="primary" loading={busy} disabled={busy} onClick={() => void makeDefault()} className="rounded-full">
          {t("defaultApp.make")}
        </Button>
      </div>
    </section>
  );
}
