import { useT } from "./i18nContext";
import type { FileTask } from "./useFileActions";

export function BusyToast({ task, onCancel }: { task: NonNullable<FileTask>; onCancel: () => void }) {
  const t = useT();
  const text = task.kind === "print" ? t("preparingPrint", { done: task.done, total: task.total }) : t("downloading");
  return (
    <div class="vp-busy vp-glass" role="status">
      <span class="vp-busy-text">{text}</span>
      {task.kind === "print" ? <progress class="vp-busy-progress" max={Math.max(task.total, 1)} value={task.done} aria-hidden="true" /> : null}
      <button type="button" class="vp-text-btn" onClick={onCancel}>
        {t("cancel")}
      </button>
    </div>
  );
}
