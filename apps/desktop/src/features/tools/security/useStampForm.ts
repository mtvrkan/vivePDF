import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GRID_POSITIONS, PAGE_SIDES, presetChoice, presetColor, presetFlag, presetNumber, presetText } from "@/features/tools/security/markPresetStore";
import type { StampForm, StampSetters } from "@/features/tools/security/StampSection";
import { DEFAULT_MARK_FONT } from "@/features/tools/security/useWatermarkForm";
import { DEFAULT_DATE_FORMAT, knownDateFormat } from "@/shared/lib/dateFormats";
import type { PageSide, StampPosition } from "@/types";

export function useStampForm() {
  const { t } = useTranslation();
  const [stampFontId, setStampFontId] = useState(DEFAULT_MARK_FONT);
  const [stampPreset, setStampPreset] = useState("approved");
  const [stampText, setStampText] = useState(() => t("tools.security.stamp.presets.approved"));
  const [stampName, setStampName] = useState("");
  const [stampSize, setStampSize] = useState(28);
  const [stampColor, setStampColor] = useState("#1e8449");
  const [stampPosition, setStampPosition] = useState<StampPosition>("top-right");
  const [stampRotation, setStampRotation] = useState(-12);
  const [stampOpacity, setStampOpacity] = useState(85);
  const [stampBorder, setStampBorder] = useState(true);
  const [stampDateFormat, setStampDateFormat] = useState(DEFAULT_DATE_FORMAT);
  const [stampPages, setStampPages] = useState("");
  const [stampSide, setStampSide] = useState<PageSide>("all");
  const [stampBehind, setStampBehind] = useState(false);
  const [stampOffsetX, setStampOffsetX] = useState(0);
  const [stampOffsetY, setStampOffsetY] = useState(0);

  const form: StampForm = { stampPreset, stampText, stampName, stampFontId, stampSize, stampColor, stampOpacity, stampRotation, stampPosition, stampOffsetX, stampOffsetY, stampBehind, stampPages, stampSide, stampBorder, stampDateFormat };
  const set: StampSetters = { setStampPreset, setStampText, setStampName, setStampFontId, setStampSize, setStampColor, setStampOpacity, setStampRotation, setStampPosition, setStampOffsetX, setStampOffsetY, setStampBehind, setStampPages, setStampSide, setStampBorder, setStampDateFormat };

  const settings = () => ({ stampText, stampName, stampSize, stampColor, stampFontId, stampPosition, stampRotation, stampOpacity, stampBorder, stampBehind, stampOffsetX, stampOffsetY, stampSide, stampDateFormat });

  const apply = (mark: Record<string, unknown>) => {
    setStampText(presetText(mark.stampText, "") || stampText);
    setStampName(presetText(mark.stampName, ""));
    setStampSize(presetNumber(mark.stampSize, 6, 200, 28));
    setStampColor(presetColor(mark.stampColor, "#1e8449"));
    setStampFontId(presetText(mark.stampFontId, DEFAULT_MARK_FONT) || DEFAULT_MARK_FONT);
    setStampPosition(presetChoice(mark.stampPosition, GRID_POSITIONS, "top-right"));
    setStampRotation(presetNumber(mark.stampRotation, -45, 45, -12));
    setStampOpacity(presetNumber(mark.stampOpacity, 10, 100, 85));
    setStampBorder(presetFlag(mark.stampBorder, true));
    setStampBehind(presetFlag(mark.stampBehind, false));
    setStampOffsetX(presetNumber(mark.stampOffsetX, -50, 50, 0));
    setStampOffsetY(presetNumber(mark.stampOffsetY, -50, 50, 0));
    setStampSide(presetChoice(mark.stampSide, PAGE_SIDES, "all"));
    setStampDateFormat(knownDateFormat(mark.stampDateFormat));
  };

  return { form, set, settings, apply };
}

export type StampSettings = ReturnType<ReturnType<typeof useStampForm>["settings"]>;
