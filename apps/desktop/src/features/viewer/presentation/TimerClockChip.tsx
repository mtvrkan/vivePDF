import { useEffect, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { usePresentationStore } from "@/shared/store/presentationStore";

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function TimerClockChip() {
  const { t } = useTranslation();
  const showClock = usePresentationStore((state) => state.showClock);
  const showTimer = usePresentationStore((state) => state.showTimer);
  const timerRunning = usePresentationStore((state) => state.timerRunning);
  const timerStartedAt = usePresentationStore((state) => state.timerStartedAt);
  const timerElapsedMs = usePresentationStore((state) => state.timerElapsedMs);
  const toggleTimerRunning = usePresentationStore((state) => state.toggleTimerRunning);
  const resetTimer = usePresentationStore((state) => state.resetTimer);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!timerRunning) return;
    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, [timerRunning]);

  useEffect(() => {
    if (!showClock) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000 * 30);
    return () => window.clearInterval(interval);
  }, [showClock]);

  if (!showClock && !showTimer) return null;

  const elapsed = timerRunning && timerStartedAt !== null ? now - timerStartedAt : timerElapsedMs;

  return (
    <div className="glass pointer-events-auto flex h-9 items-center gap-2 rounded-full px-3 font-mono text-xs tabular-nums">
      {showClock ? <span className="text-muted-foreground">{new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span> : null}
      {showClock && showTimer ? <span className="h-3 w-px bg-border" aria-hidden /> : null}
      {showTimer ? (
        <>
          <span>{formatElapsed(elapsed)}</span>
          <IconButton icon={timerRunning ? Pause : Play} label={t(timerRunning ? "presentation.timerPause" : "presentation.timerStart")} onClick={toggleTimerRunning} />
          <IconButton icon={RotateCcw} label={t("presentation.timerReset")} onClick={resetTimer} />
        </>
      ) : null}
    </div>
  );
}
