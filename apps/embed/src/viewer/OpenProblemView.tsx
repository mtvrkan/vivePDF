import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { MessageKey } from "../i18n";
import { Icon, type IconName } from "./Icon";
import { useT } from "./i18nContext";
import { safeExternalUrl } from "./links";
import type { OpenProblem } from "./openError";

type OpenProblemViewProps = {
  problem: OpenProblem;
  sourceUrl: string;
  busy: boolean;
  onRetry: () => void;
  onPassword: (password: string) => void;
};

const SHAPES: Record<OpenProblem, { icon: IconName; title: MessageKey; text: MessageKey }> = {
  password: { icon: "lock", title: "passwordTitle", text: "passwordText" },
  wrongPassword: { icon: "lock", title: "passwordTitle", text: "passwordText" },
  notFound: { icon: "fileMissing", title: "notFoundTitle", text: "notFoundText" },
  network: { icon: "offline", title: "networkTitle", text: "networkText" },
  damaged: { icon: "fileBroken", title: "damagedTitle", text: "damagedText" },
  noPages: { icon: "fileBroken", title: "noPagesTitle", text: "noPagesText" },
  unknown: { icon: "alert", title: "unknownTitle", text: "unknownText" },
  engine: { icon: "alert", title: "engineTitle", text: "engineText" },
};

function PasswordForm({ wrong, busy, onPassword }: { wrong: boolean; busy: boolean; onPassword: (password: string) => void }) {
  const t = useT();
  const inputId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (busy) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [busy, wrong]);

  return (
    <form
      class="vp-password"
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        if (password && !busy) onPassword(password);
      }}
    >
      <label class="vp-password-label" for={inputId}>
        {t("passwordLabel")}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        class="vp-password-input"
        type="password"
        autoComplete="off"
        value={password}
        aria-invalid={wrong}
        aria-describedby={wrong ? errorId : undefined}
        onInput={(event) => setPassword(event.currentTarget.value)}
      />
      {wrong ? (
        <p id={errorId} class="vp-password-error">
          {t("passwordWrong")}
        </p>
      ) : null}
      <button type="submit" class="vp-primary-btn" disabled={busy || password.length === 0}>
        {t("passwordSubmit")}
      </button>
    </form>
  );
}

export function OpenProblemView({ problem, sourceUrl, busy, onRetry, onPassword }: OpenProblemViewProps) {
  const t = useT();
  const shape = SHAPES[problem];
  const locked = problem === "password" || problem === "wrongPassword";
  const offersDownload = problem === "damaged" || problem === "noPages";
  const download = offersDownload ? safeExternalUrl(sourceUrl, document.baseURI) : null;
  const downloadable = download !== null && /^https?:/.test(download);

  return (
    <div class="vp-notice" role={locked ? undefined : "alert"}>
      <div class="vp-notice-card">
        <Icon name={shape.icon} />
        <p class="vp-note-title">{t(shape.title)}</p>
        <p>{t(shape.text)}</p>
        {locked ? <PasswordForm wrong={problem === "wrongPassword"} busy={busy} onPassword={onPassword} /> : null}
        {offersDownload && downloadable ? (
          <a class="vp-text-btn" href={download} download>
            <Icon name="download" />
            {t("downloadFile")}
          </a>
        ) : null}
        {problem === "notFound" || problem === "network" || problem === "unknown" || problem === "engine" ? (
          <button type="button" class="vp-text-btn" disabled={busy} onClick={onRetry}>
            {t("retry")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
