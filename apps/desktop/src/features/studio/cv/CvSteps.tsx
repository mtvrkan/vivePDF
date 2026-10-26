import type { KeyboardEvent } from "react";
import { Check, EyeOff, Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/cn";
import type { CvStep } from "./CvForm";
import { sectionVisible, type CvProfile, type CvSectionKey } from "./cvModel";
import { useCvStore } from "./cvStore";
import { cvSteps, type CvStepId } from "./stepOrder";

const COUNTED: Partial<Record<CvSectionKey, (profile: CvProfile) => number>> = {
  experience: (profile) => profile.experience.length,
  education: (profile) => profile.education.length,
  skills: (profile) => profile.skills.length,
  languages: (profile) => profile.languages.length,
  certificates: (profile) => profile.certificates.length,
  projects: (profile) => profile.projects.length,
  references: (profile) => profile.references.length,
  custom: (profile) => profile.custom.length,
};

function filled(profile: CvProfile, step: CvStep): boolean {
  if (step === "personal") return profile.name.trim() !== "" || profile.headline.trim() !== "" || profile.contacts.some((contact) => contact.value.trim() !== "");
  return sectionVisible({ ...profile, hidden: [] }, step);
}

export function CvSteps({ step, onChange }: { step: CvStepId; onChange: (step: CvStepId) => void }) {
  const { t } = useTranslation();
  const profile = useCvStore((state) => state.profile);
  const steps = cvSteps(profile.order);
  const labelOf = (item: CvStepId) => (item === "design" ? t("studio.cv.tabs.design") : item === "personal" ? t("studio.cv.personal") : t(`studio.cv.sections.${item}`));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = steps.indexOf(step);
    const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? steps.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const target = steps[(next + steps.length) % steps.length];
    onChange(target);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-cv-step="${target}"]`)?.focus();
  };

  const row = (item: CvStepId) => {
    const selected = step === item;
    const done = item !== "design" && filled(profile, item);
    const hidden = item !== "design" && item !== "personal" && profile.hidden.includes(item);
    const count = item !== "design" && item !== "personal" ? COUNTED[item]?.(profile) : undefined;
    const label = labelOf(item);
    return (
      <button
        key={item}
        type="button"
        role="tab"
        id={`cv-step-${item}`}
        aria-selected={selected}
        aria-controls="cv-step-panel"
        tabIndex={selected ? 0 : -1}
        data-cv-step={item}
        onClick={() => onChange(item)}
        className={cn(
          "flex h-9 w-full shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-start text-sm outline-none transition-colors duration-(--transition-fast) focus-visible:ring-2 focus-visible:ring-ring",
          selected ? "menubar-active font-medium text-foreground" : "text-foreground/85 hover:bg-(--hover-bg) hover:text-foreground",
        )}
      >
        {item === "design" ? (
          <Palette className={cn("size-4 shrink-0", selected ? "text-primary" : "text-muted-foreground")} aria-hidden />
        ) : (
          <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full", done ? "bg-success text-primary-foreground" : "border border-border")} aria-hidden>
            {done ? <Check className="size-3" strokeWidth={3} /> : null}
          </span>
        )}
        <span className={cn("min-w-0 flex-1 truncate", hidden && "text-muted-foreground line-through")}>{label}</span>
        {done ? <span className="sr-only">{t("studio.cv.steps.filled")}</span> : null}
        {hidden ? <EyeOff className="size-3.5 shrink-0 text-muted-foreground" aria-label={t("studio.cv.steps.hidden")} /> : null}
        {count ? <span className="font-mono text-xs tabular-nums text-muted-foreground">{count}</span> : null}
      </button>
    );
  };

  return (
    <div role="tablist" aria-orientation="vertical" aria-label={t("studio.cv.panel")} className="flex flex-col gap-0.5" onKeyDown={onKeyDown}>
      <p className="px-2.5 pb-1 pt-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{t("studio.cv.tabs.content")}</p>
      {steps.filter((item) => item !== "design").map(row)}
      <span className="my-2 h-px bg-border" aria-hidden />
      {row("design")}
    </div>
  );
}
