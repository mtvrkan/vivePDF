import { useEffect, useState } from "react";
import { parseZoomPercent } from "./zoomShortcuts";

type ZoomInputProps = { percent: number; label: string; onApply: (percent: number) => void };

export function ZoomInput({ percent, label, onApply }: ZoomInputProps) {
  const [draft, setDraft] = useState(`${percent}%`);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(`${percent}%`);
  }, [percent, focused]);

  const commit = () => {
    const parsed = parseZoomPercent(draft);
    if (parsed !== null && parsed !== percent) onApply(parsed);
    setDraft(`${parsed ?? percent}%`);
  };

  return (
    <form
      className="shrink-0"
      onSubmit={(event) => {
        event.preventDefault();
        commit();
        (event.currentTarget.firstElementChild as HTMLInputElement | null)?.blur();
      }}
    >
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => {
          setFocused(true);
          event.target.select();
        }}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        aria-label={label}
        inputMode="numeric"
        className="field-inline h-7 w-16 rounded-md text-center font-mono text-xs tabular-nums"
      />
    </form>
  );
}
