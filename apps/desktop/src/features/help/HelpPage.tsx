import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ArrowRight, BookOpenText, Search, SearchX, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { cn } from "@/shared/lib/cn";
import { helpTopic, helpTopicText, matchingTopics, type HelpTopic } from "./helpTopics";

function TopicArticle({ topic }: { topic: HelpTopic }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { title, summary, steps } = helpTopicText(t, topic);
  const Icon = topic.icon;
  const route = topic.route;

  return (
    <article aria-labelledby="help-topic-title" className="glass flex flex-col gap-5 rounded-2xl p-6">
      <div className="flex items-start gap-4">
        <span aria-hidden className="tone-tile flex size-11 shrink-0 items-center justify-center rounded-xl">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id="help-topic-title" className="text-lg font-semibold leading-7 tracking-tight">
            {title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
        </div>
      </div>
      <ol className="flex flex-col gap-3" data-testid="help-steps">
        {steps.map((step, index) => (
          <li key={index} className="flex gap-3 text-sm leading-6">
            <span aria-hidden className="tone-tile flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-xs">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">{step}</span>
          </li>
        ))}
      </ol>
      {route ? (
        <div>
          <Button variant="secondary" icon={<ArrowRight className="size-4 rtl:rotate-180" aria-hidden />} onClick={() => void navigate(route)}>
            {t("help.openScreen")}
          </Button>
        </div>
      ) : null}
    </article>
  );
}

export function HelpPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const topics = useMemo(() => matchingTopics(t, query), [t, query]);
  const requested = helpTopic(params.get("topic"));
  const selected = requested && topics.includes(requested) ? requested : topics[0];

  const select = (topic: HelpTopic) => setParams({ topic: topic.id }, { replace: true });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t("help.title")}
        description={t("help.description")}
        icon={BookOpenText}
        eyebrow={t("nav.help")}
        actions={
          <label className="glass-flat relative flex h-9 w-72 max-w-full items-center rounded-lg border ps-9">
            <Search className="pointer-events-none absolute start-3 size-4 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("help.search")}
              aria-label={t("help.search")}
              className="h-full w-full bg-transparent pe-9 text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <button type="button" onClick={() => setQuery("")} aria-label={t("help.clearSearch")} className="absolute end-2 flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-(--hover-bg) hover:text-foreground">
                <X className="size-3.5" aria-hidden />
              </button>
            ) : null}
          </label>
        }
      />
      <div className="scrollbar-stable min-h-0 flex-1 overflow-y-auto">
        {selected ? (
          <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 pb-8 pt-6 md:grid-cols-[17rem_minmax(0,1fr)] md:px-6">
            <nav aria-label={t("help.title")} className="md:sticky md:top-0 md:self-start">
              <ul className="space-y-0.5">
                {topics.map((topic) => {
                  const Icon = topic.icon;
                  const active = topic === selected;
                  return (
                    <li key={topic.id}>
                      <button
                        type="button"
                        aria-current={active ? "page" : undefined}
                        onClick={() => select(topic)}
                        className={cn(
                          "flex h-10 w-full items-center gap-3 rounded-xl px-1.5 text-sm transition-[color,background-color,box-shadow] duration-(--transition-fast)",
                          active ? "tone-active font-medium text-foreground" : "nav-glass text-foreground/80 hover:text-foreground",
                        )}
                      >
                        <span
                          className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", active ? "tone-tile" : "text-(--tone)")}
                          style={active ? undefined : { background: "color-mix(in oklab, var(--tone) 13%, transparent)" }}
                        >
                          <Icon className="size-3.5" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-start">{t(`help.topics.${topic.id}.title`)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
            <TopicArticle topic={selected} />
          </div>
        ) : (
          <EmptyState
            icon={SearchX}
            title={t("help.noMatchesTitle", { query: query.trim() })}
            description={t("help.noMatchesDescription")}
            action={
              <Button variant="secondary" onClick={() => setQuery("")}>
                {t("help.clearSearch")}
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
}
