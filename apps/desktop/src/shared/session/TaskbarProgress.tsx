import { useEffect } from "react";
import { getCurrentWindow, ProgressBarStatus } from "@tauri-apps/api/window";
import { useOperationStore } from "@/shared/store/operationStore";

export function TaskbarProgress() {
  const running = useOperationStore((state) => state.running);
  const progress = useOperationStore((state) => state.progress);

  useEffect(() => {
    const state =
      running === 0
        ? { status: ProgressBarStatus.None }
        : progress === null
          ? { status: ProgressBarStatus.Indeterminate }
          : { status: ProgressBarStatus.Normal, progress: Math.min(100, Math.max(0, Math.round(progress * 100))) };
    void getCurrentWindow().setProgressBar(state).catch(() => undefined);
  }, [running, progress]);

  useEffect(() => {
    return () => {
      void getCurrentWindow().setProgressBar({ status: ProgressBarStatus.None }).catch(() => undefined);
    };
  }, []);

  return null;
}
