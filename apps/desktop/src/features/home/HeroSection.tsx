import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { FolderOpen, Search as SearchIcon, UploadCloud } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { cn } from "@/shared/lib/cn";
import { useOpenPdf } from "@/features/viewer/useOpenPdf";
import { useOpenStore } from "@/shared/store/openStore";

function greetingKey(hour: number): "morning" | "afternoon" | "evening" {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function Kbd({ children }: { children: string }) {
  return <kbd className="rounded-md border bg-card/70 px-1.5 py-0.5 font-mono text-[11px] leading-none text-muted-foreground">{children}</kbd>;
}

export function HeroSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pickAndOpen } = useOpenPdf();
  const busy = useOpenStore((state) => state.busy);
  const [dragDepth, setDragDepth] = useState(0);
  const greeting = useMemo(() => t(`home.greeting.${greetingKey(new Date().getHours())}`), [t]);

  return (
    <section className="glass glass-tinted rounded-2xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">{t("home.eyebrow")}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.01em]">{greeting}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("home.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant="primary"
            icon={<FolderOpen className="size-4" aria-hidden />}
            loading={busy}
            onClick={() => void pickAndOpen()}
            className="h-11 rounded-full px-5 text-base"
          >
            {t("common.openPdf")}
          </Button>
          <Button icon={<SearchIcon className="size-4" aria-hidden />} onClick={() => void navigate("/search")} className="h-11 rounded-full px-5 text-base">
            {t("nav.folderSearch")}
          </Button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => void pickAndOpen()}
        disabled={busy}
        data-active={dragDepth > 0 || undefined}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragDepth((depth) => depth + 1);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragDepth((depth) => Math.max(0, depth - 1));
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={() => setDragDepth(0)}
        className={cn(
          "mt-5 flex h-16 w-full items-center justify-between gap-4 rounded-xl border-2 border-dashed border-(--glass-border) px-5 text-sm text-muted-foreground outline-none transition-colors duration-(--transition-fast) hover:border-primary/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none",
          dragDepth > 0 && "border-primary/70 bg-primary/5 text-primary",
        )}
      >
        <span className="flex min-w-0 items-center gap-3">
          <UploadCloud className="size-5 shrink-0" aria-hidden />
          <span className="truncate font-medium text-foreground">{t("home.dropHint")}</span>
        </span>
        <span className="flex shrink-0 items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5">
            <Kbd>Ctrl O</Kbd>
            {t("common.openPdf")}
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>Ctrl K</Kbd>
            {t("emptyDoc.palette")}
          </span>
        </span>
      </button>
    </section>
  );
}
