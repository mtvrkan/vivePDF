import { useState } from "react";
import { FLATTEN_DPIS, PAGE_SIDES, WATERMARK_POSITIONS, presetChoice, presetColor, presetFlag, presetNumber, presetText } from "@/features/tools/security/markPresetStore";
import type { WatermarkForm, WatermarkSetters } from "@/features/tools/security/WatermarkSection";
import type { PageSide, WatermarkKind, WatermarkPosition, WatermarkVisibility } from "@/types";

export const DEFAULT_MARK_FONT = "bundled:dejavu-sans";

export function useWatermarkForm() {
  const [fontId, setFontId] = useState(DEFAULT_MARK_FONT);
  const [kind, setKind] = useState<WatermarkKind>("text");
  const [templatePath, setTemplatePath] = useState("");
  const [templatePage, setTemplatePage] = useState(1);
  const [text, setText] = useState("");
  const [imagePath, setImagePath] = useState("");
  const [fontSize, setFontSize] = useState(48);
  const [bold, setBold] = useState(true);
  const [color, setColor] = useState("#c00000");
  const [opacity, setOpacity] = useState(30);
  const [rotation, setRotation] = useState(45);
  const [position, setPosition] = useState<WatermarkPosition>("center");
  const [scale, setScale] = useState(50);
  const [pages, setPages] = useState("");
  const [side, setSide] = useState<PageSide>("all");
  const [tileGap, setTileGap] = useState(100);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [behind, setBehind] = useState(false);
  const [flatten, setFlatten] = useState(false);
  const [flattenDpi, setFlattenDpi] = useState(150);
  const [visibility, setVisibility] = useState<WatermarkVisibility>("always");

  const form: WatermarkForm = { kind, templatePath, templatePage, text, imagePath, fontId, fontSize, bold, color, opacity, rotation, position, scale, tileGap, offsetX, offsetY, behind, pages, side, flatten, flattenDpi, visibility };
  const set: WatermarkSetters = { setKind, setTemplatePath, setTemplatePage, setText, setImagePath, setFontId, setFontSize, setBold, setColor, setOpacity, setRotation, setPosition, setScale, setTileGap, setOffsetX, setOffsetY, setBehind, setPages, setSide, setFlatten, setFlattenDpi, setVisibility };

  const settings = () => ({ kind, text, imagePath, templatePath, templatePage, fontSize, bold, color, fontId, opacity, rotation, position, scale, tileGap, offsetX, offsetY, behind, side, flatten, flattenDpi, visibility });

  const apply = (mark: Record<string, unknown>) => {
    setKind(presetChoice<WatermarkKind>(mark.kind, ["text", "image", "pdf"], "text"));
    setText(presetText(mark.text, ""));
    setImagePath(presetText(mark.imagePath, ""));
    setTemplatePath(presetText(mark.templatePath, ""));
    setTemplatePage(Math.round(presetNumber(mark.templatePage, 1, 9999, 1)));
    setFontSize(presetNumber(mark.fontSize, 4, 400, 48));
    setBold(presetFlag(mark.bold, true));
    setColor(presetColor(mark.color, "#c00000"));
    setFontId(presetText(mark.fontId, DEFAULT_MARK_FONT) || DEFAULT_MARK_FONT);
    setOpacity(presetNumber(mark.opacity, 2, 100, 30));
    setRotation(presetNumber(mark.rotation, -90, 90, 45));
    setPosition(presetChoice(mark.position, WATERMARK_POSITIONS, "center"));
    setScale(presetNumber(mark.scale, 5, 100, 50));
    setTileGap(presetNumber(mark.tileGap, 40, 400, 100));
    setOffsetX(presetNumber(mark.offsetX, -50, 50, 0));
    setOffsetY(presetNumber(mark.offsetY, -50, 50, 0));
    setBehind(presetFlag(mark.behind, false));
    setSide(presetChoice(mark.side, PAGE_SIDES, "all"));
    setFlatten(presetFlag(mark.flatten, false));
    setFlattenDpi(presetChoice(mark.flattenDpi, FLATTEN_DPIS, 150));
    setVisibility(presetChoice<WatermarkVisibility>(mark.visibility, ["always", "print", "screen"], "always"));
  };

  return { form, set, settings, apply };
}

export type WatermarkSettings = ReturnType<ReturnType<typeof useWatermarkForm>["settings"]>;
