import { useRef } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";

type MoveButtonsProps = { name: string; index: number; total: number; onMove: (from: number, to: number) => void };

export function MoveButtons({ name, index, total, onMove }: MoveButtonsProps) {
  const { t } = useTranslation();
  const up = useRef<HTMLButtonElement>(null);
  const down = useRef<HTMLButtonElement>(null);
  const move = (step: -1 | 1) => {
    const pressed = step < 0 ? up.current : down.current;
    const other = step < 0 ? down.current : up.current;
    const focused = pressed !== null && document.activeElement === pressed;
    onMove(index, index + step);
    if (!focused) return;
    window.requestAnimationFrame(() => {
      const target = pressed.isConnected && !pressed.disabled ? pressed : other;
      if (target?.isConnected && document.activeElement !== target) target.focus();
    });
  };
  return (
    <>
      <IconButton ref={up} icon={ArrowUp} label={t("studio.cv.moveUp", { name })} disabled={index === 0} onClick={() => move(-1)} />
      <IconButton ref={down} icon={ArrowDown} label={t("studio.cv.moveDown", { name })} disabled={index === total - 1} onClick={() => move(1)} />
    </>
  );
}
