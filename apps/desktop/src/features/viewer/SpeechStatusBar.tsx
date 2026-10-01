import { Pause, Play, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { useSpeechStore } from "@/shared/store/speechStore";

export function SpeechStatusBar() {
  const { t } = useTranslation();
  const status = useSpeechStore((state) => state.status);
  const owner = useSpeechStore((state) => state.owner);
  const text = useSpeechStore((state) => state.text);
  const pause = useSpeechStore((state) => state.pause);
  const resume = useSpeechStore((state) => state.resume);
  const stop = useSpeechStore((state) => state.stop);

  if (status === "idle" || owner !== "selection") return null;

  return (
    <div className="glass-flat flex h-9 shrink-0 items-center gap-2 border-b px-3 text-xs" role="status">
      <span className="shrink-0 font-medium text-muted-foreground">{t("viewer.readAloud.selection")}</span>
      {status === "speaking" ? (
        <IconButton icon={Pause} label={t("viewer.readAloud.pause")} onClick={pause} />
      ) : (
        <IconButton icon={Play} label={t("viewer.readAloud.play")} onClick={resume} />
      )}
      <IconButton icon={Square} label={t("viewer.readAloud.stop")} onClick={stop} />
      <span title={text} className="min-w-0 flex-1 truncate text-muted-foreground">{text}</span>
    </div>
  );
}
