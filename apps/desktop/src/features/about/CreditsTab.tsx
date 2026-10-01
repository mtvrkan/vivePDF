import { useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { ErrorState } from "@/components/shared/ErrorState";
import { SkeletonCard } from "@/components/shared/SkeletonCard";
import { CONTRIBUTORS, CONTRIBUTORS_API_URL, mergeContributors, parseContributors, sizedAvatarUrl, THANKS, type Contributor } from "./credits";

type ContributorsState = "idle" | "loading" | "loaded" | "error";

function SectionTitle({ children }: { children: string }) {
  return <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{children}</p>;
}

function ContributorAvatar({ contributor }: { contributor: Contributor }) {
  const [failed, setFailed] = useState(false);
  const initials = contributor.name.slice(0, 2).toUpperCase();
  if (!contributor.avatarUrl || failed) {
    return (
      <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
        {initials}
      </div>
    );
  }
  return (
    <img
      src={sizedAvatarUrl(contributor.avatarUrl)}
      alt=""
      referrerPolicy="no-referrer"
      decoding="async"
      onError={() => setFailed(true)}
      className="size-14 shrink-0 rounded-full object-cover"
    />
  );
}

function ContributorCard({ contributor }: { contributor: Contributor }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={() => void openUrl(contributor.htmlUrl)}
      className="glass flex flex-col items-center gap-2 rounded-2xl p-5 text-center outline-none transition-[background-color,box-shadow] duration-(--transition-fast) hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ContributorAvatar contributor={contributor} />
      <span className="w-full truncate text-sm font-semibold" title={contributor.name}>
        {contributor.name}
      </span>
      <span className="truncate font-mono text-xs text-muted-foreground" title={`@${contributor.login}`}>
        @{contributor.login}
      </span>
      <span className="glass-chip rounded-full px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">{t(contributor.roleKey)}</span>
      {contributor.contributions !== null ? (
        <span className="text-[11px] text-muted-foreground">{t("about.credits.contributors.commitCount", { count: contributor.contributions })}</span>
      ) : null}
    </button>
  );
}

function ContributorsGrid() {
  const { t } = useTranslation();
  const [state, setState] = useState<ContributorsState>("idle");
  const [contributors, setContributors] = useState<Contributor[]>(CONTRIBUTORS);

  const refresh = async () => {
    setState("loading");
    try {
      const response = await fetch(CONTRIBUTORS_API_URL);
      if (!response.ok) throw new Error(String(response.status));
      const raw: unknown = await response.json();
      setContributors(mergeContributors(CONTRIBUTORS, parseContributors(raw)));
      setState("loaded");
    } catch {
      setState("error");
    }
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-4">
        <SectionTitle>{t("about.credits.contributors.title")}</SectionTitle>
        <Button variant="ghost" size="sm" icon={<RefreshCw className="size-4" aria-hidden />} loading={state === "loading"} onClick={() => void refresh()}>
          {t("about.credits.contributors.refresh")}
        </Button>
      </div>
      {state === "error" ? (
        <ErrorState title={t("about.credits.contributors.errorTitle")} message={t("about.credits.contributors.errorMessage")} onRetry={() => void refresh()} />
      ) : null}
      {state === "loading" ? <SkeletonCard lines={3} /> : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {contributors.map((contributor) => (
          <ContributorCard key={contributor.login} contributor={contributor} />
        ))}
      </div>
    </div>
  );
}

function ThanksGrid() {
  const { t } = useTranslation();
  return (
    <div>
      <SectionTitle>{t("about.credits.thanks.title")}</SectionTitle>
      <p className="measure mb-3 text-sm text-muted-foreground">{t("about.credits.thanks.intro")}</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {THANKS.map((person) => (
          <ContributorCard key={person.login} contributor={person} />
        ))}
      </div>
    </div>
  );
}

export function CreditsTab() {
  const { t } = useTranslation();
  return (
    <div className="space-y-8">
      <p className="measure text-base leading-6">{t("about.credits.intro")}</p>
      <ContributorsGrid />
      <ThanksGrid />
    </div>
  );
}
