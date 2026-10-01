import { useRef, type KeyboardEvent } from "react";

export function useRovingRadios<T>(options: readonly T[], current: number, onSelect: (option: T) => void, columns?: number) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const row = columns ?? 1;
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" ? row : event.key === "ArrowUp" ? -row : 0;
    if (step === 0 || options.length === 0) return;
    event.preventDefault();
    const next = (current + step + options.length) % options.length;
    onSelect(options[next]);
    buttons.current[next]?.focus();
  };

  return {
    onKeyDown,
    refOf: (index: number) => (node: HTMLButtonElement | null) => {
      buttons.current[index] = node;
    },
    tabIndexOf: (index: number) => (index === current ? 0 : -1),
  };
}
