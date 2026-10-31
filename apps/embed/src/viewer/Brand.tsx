import { useT } from "./i18nContext";

export const BRAND_URL = "https://vivepdf.com/?ref=viewer";

export function Brand() {
  const t = useT();
  return (
    <a class="vp-brand" href={BRAND_URL} target="_blank" rel="noopener" aria-label={t("poweredBy")} title={t("poweredBy")}>
      <svg class="vp-brand-mark" viewBox="0 0 256 256" aria-hidden="true">
        <rect class="vp-brand-tile" x="8" y="8" width="240" height="240" rx="60" />
        <path class="vp-brand-left" d="M60 60H104L148 196H104Z" />
        <path class="vp-brand-right" d="M152 60H176L189.6 80L152 196H108Z" />
        <path class="vp-brand-flap" d="M176 60V80H189.6Z" />
      </svg>
    </a>
  );
}
