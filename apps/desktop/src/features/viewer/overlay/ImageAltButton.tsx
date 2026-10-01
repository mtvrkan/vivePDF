import { useId, useState } from "react";
import { Captions } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { TextArea } from "@/components/tool/form";
import { MAX_ALT_CHARS } from "./drawing/drawingAltText";

export function ImageAltButton({ value, onBegin, onChange }: { value: string; onBegin: () => void; onChange: (alt: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const hintId = useId();

  return (
    <span className="relative">
      <IconButton icon={Captions} label={t("viewer.overlay.altText")} active={open || value.trim() !== ""} onClick={() => setOpen((current) => !current)} />
      {open ? (
        <div role="dialog" aria-labelledby={labelId} className="glass-menu absolute start-0 top-9 z-50 w-72 rounded-lg p-2">
          <p id={labelId} className="mb-1.5 text-sm font-medium text-foreground/80">
            {t("viewer.overlay.altText")}
          </p>
          <TextArea
            autoFocus
            rows={3}
            value={value}
            maxLength={MAX_ALT_CHARS}
            onFocus={onBegin}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
            }}
            aria-labelledby={labelId}
            aria-describedby={hintId}
            className="text-sm"
          />
          <p id={hintId} className="mt-1.5 text-xs text-muted-foreground">
            {t("viewer.overlay.altTextHint")}
          </p>
        </div>
      ) : null}
    </span>
  );
}
