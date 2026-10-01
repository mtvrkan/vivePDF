import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { DATE_FORMATS } from "@/shared/lib/dateFormats";
import { wholeWithin, withinRange } from "@/shared/lib/numberRange";
import type { CropMode, FlattenImageFormat, FurnitureScope, NumberStyle, PageSide, ResizeMode, TextPosition } from "@/types";
import {
  CROP_AUTO_MARGIN_MM,
  CROP_INSET_MM,
  FURNITURE_MARGIN_MM,
  HEADER_FONT_SIZE,
  NUMBER_FONT_SIZE,
  NUMBER_PADDING,
  NUMBER_START,
  RESIZE_MARGIN_MM,
  RESIZE_SIDE_MM,
  TEMPLATE_PAGE,
  type HeaderMode,
} from "./editShared";

export function useStampState() {
  const [marginMm, setMarginMm] = useState(10);
  const [color, setColor] = useState("#000000");
  const [bold, setBold] = useState(false);
  const [fontId, setFontId] = useState("bundled:dejavu-sans");
  const marginValid = withinRange(marginMm, FURNITURE_MARGIN_MM);
  return { marginMm, setMarginMm, color, setColor, bold, setBold, fontId, setFontId, marginValid };
}

export type StampState = ReturnType<typeof useStampState>;

export function useNumberState() {
  const [position, setPosition] = useState<TextPosition>("bottom-center");
  const [template, setTemplate] = useState("{n}");
  const [start, setStart] = useState(1);
  const [numberFontSize, setNumberFontSize] = useState(11);
  const [numberPrefix, setNumberPrefix] = useState("");
  const [numberPadding, setNumberPadding] = useState(0);
  const [numberSuffix, setNumberSuffix] = useState("");
  const [numberStyle, setNumberStyle] = useState<NumberStyle>("arabic");
  const [numberSide, setNumberSide] = useState<PageSide>("all");
  const [numberMirror, setNumberMirror] = useState(false);
  const [numberLabels, setNumberLabels] = useState(false);
  const [numberReplace, setNumberReplace] = useState(false);
  const numberFontValid = withinRange(numberFontSize, NUMBER_FONT_SIZE);
  const startValid = wholeWithin(start, NUMBER_START);
  const paddingValid = wholeWithin(numberPadding, NUMBER_PADDING);
  return {
    position,
    setPosition,
    template,
    setTemplate,
    start,
    setStart,
    numberFontSize,
    setNumberFontSize,
    numberPrefix,
    setNumberPrefix,
    numberPadding,
    setNumberPadding,
    numberSuffix,
    setNumberSuffix,
    numberStyle,
    setNumberStyle,
    numberSide,
    setNumberSide,
    numberMirror,
    setNumberMirror,
    numberLabels,
    setNumberLabels,
    numberReplace,
    setNumberReplace,
    numberFontValid,
    startValid,
    paddingValid,
  };
}

export type NumberState = ReturnType<typeof useNumberState>;

export function useHeaderFooterState() {
  const [headerFontSize, setHeaderFontSize] = useState(10);
  const [header, setHeader] = useState({ left: "", center: "", right: "" });
  const [footer, setFooter] = useState({ left: "", center: "", right: "" });
  const [headerMode, setHeaderMode] = useState<HeaderMode>("add");
  const [headerStart, setHeaderStart] = useState(1);
  const [headerDateFormat, setHeaderDateFormat] = useState(DATE_FORMATS[0].value);
  const [headerReplace, setHeaderReplace] = useState(false);
  const [removeScope, setRemoveScope] = useState<FurnitureScope>("vivepdf");
  const headerFontValid = withinRange(headerFontSize, HEADER_FONT_SIZE);
  return {
    headerFontSize,
    setHeaderFontSize,
    header,
    setHeader,
    footer,
    setFooter,
    headerMode,
    setHeaderMode,
    headerStart,
    setHeaderStart,
    headerDateFormat,
    setHeaderDateFormat,
    headerReplace,
    setHeaderReplace,
    removeScope,
    setRemoveScope,
    headerFontValid,
  };
}

export type HeaderFooterState = ReturnType<typeof useHeaderFooterState>;

export function useLetterheadState() {
  const [letterheadPath, setLetterheadPath] = useState("");
  const [letterheadFirstPath, setLetterheadFirstPath] = useState("");
  const [letterheadPosition, setLetterheadPosition] = useState<"under" | "over">("under");
  const [letterheadFit, setLetterheadFit] = useState<"stretch" | "fit">("stretch");
  const [letterheadReplace, setLetterheadReplace] = useState(false);
  const [letterheadPage, setLetterheadPage] = useState(1);
  const [letterheadFirstPage, setLetterheadFirstPage] = useState(1);
  const [letterheadPassword, setLetterheadPassword] = useState("");
  const [letterheadFirstPassword, setLetterheadFirstPassword] = useState("");
  const pickLetterhead = async (which: "main" | "first") => {
    const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (typeof selected !== "string") return;
    if (which === "main") {
      setLetterheadPath(selected);
      setLetterheadPassword("");
    } else {
      setLetterheadFirstPath(selected);
      setLetterheadFirstPassword("");
    }
  };
  const clearFirstLetterhead = () => {
    setLetterheadFirstPath("");
    setLetterheadFirstPassword("");
  };
  const letterheadPageValid = wholeWithin(letterheadPage, TEMPLATE_PAGE);
  const letterheadFirstPageValid = wholeWithin(letterheadFirstPage, TEMPLATE_PAGE);
  const letterheadPagesValid = letterheadPageValid && (!letterheadFirstPath || letterheadFirstPageValid);
  return {
    letterheadPath,
    letterheadFirstPath,
    letterheadPosition,
    setLetterheadPosition,
    letterheadFit,
    setLetterheadFit,
    letterheadReplace,
    setLetterheadReplace,
    letterheadPage,
    setLetterheadPage,
    letterheadFirstPage,
    setLetterheadFirstPage,
    letterheadPassword,
    setLetterheadPassword,
    letterheadFirstPassword,
    setLetterheadFirstPassword,
    pickLetterhead,
    clearFirstLetterhead,
    letterheadPageValid,
    letterheadFirstPageValid,
    letterheadPagesValid,
  };
}

export type LetterheadState = ReturnType<typeof useLetterheadState>;

export function useCropState() {
  const [insets, setInsets] = useState({ left: 10, top: 10, right: 10, bottom: 10 });
  const [cropMode, setCropMode] = useState<CropMode>("insets");
  const [cropSide, setCropSide] = useState<PageSide>("all");
  const [cropAutoMargin, setCropAutoMargin] = useState(2);
  const [cropRemoveContent, setCropRemoveContent] = useState(false);
  const cropAutoMarginValid = withinRange(cropAutoMargin, CROP_AUTO_MARGIN_MM);
  const cropSettingsValid = cropMode === "auto" ? cropAutoMarginValid : Object.values(insets).every((value) => withinRange(value, CROP_INSET_MM));
  return {
    insets,
    setInsets,
    cropMode,
    setCropMode,
    cropSide,
    setCropSide,
    cropAutoMargin,
    setCropAutoMargin,
    cropRemoveContent,
    setCropRemoveContent,
    cropAutoMarginValid,
    cropSettingsValid,
  };
}

export type CropState = ReturnType<typeof useCropState>;

export function useResizeState() {
  const [preset, setPreset] = useState("a4");
  const [customSize, setCustomSize] = useState({ width: 210, height: 297 });
  const [autoRotate, setAutoRotate] = useState(true);
  const [resizeMode, setResizeMode] = useState<ResizeMode>("fit");
  const [resizeMargin, setResizeMargin] = useState(0);
  const [resizeMatchLargest, setResizeMatchLargest] = useState(false);
  const resizeCustom = preset === "custom" && !resizeMatchLargest;
  const resizeWidthValid = !resizeCustom || withinRange(customSize.width, RESIZE_SIDE_MM);
  const resizeHeightValid = !resizeCustom || withinRange(customSize.height, RESIZE_SIDE_MM);
  const resizeMarginValid = resizeMode === "box" || (withinRange(resizeMargin, RESIZE_MARGIN_MM) && (!resizeCustom || resizeMargin * 2 < Math.min(customSize.width, customSize.height)));
  return {
    preset,
    setPreset,
    customSize,
    setCustomSize,
    autoRotate,
    setAutoRotate,
    resizeMode,
    setResizeMode,
    resizeMargin,
    setResizeMargin,
    resizeMatchLargest,
    setResizeMatchLargest,
    resizeCustom,
    resizeWidthValid,
    resizeHeightValid,
    resizeMarginValid,
  };
}

export type ResizeState = ReturnType<typeof useResizeState>;

export function useFlattenState() {
  const [flattenAnnotations, setFlattenAnnotations] = useState(true);
  const [flattenForms, setFlattenForms] = useState(true);
  const [flattenKeepLinks, setFlattenKeepLinks] = useState(true);
  const [flattenRasterize, setFlattenRasterize] = useState(false);
  const [flattenDpi, setFlattenDpi] = useState(150);
  const [flattenImageFormat, setFlattenImageFormat] = useState<FlattenImageFormat>("auto");
  const [flattenQuality, setFlattenQuality] = useState(85);
  const [flattenPrintedOnly, setFlattenPrintedOnly] = useState(false);
  return {
    flattenAnnotations,
    setFlattenAnnotations,
    flattenForms,
    setFlattenForms,
    flattenKeepLinks,
    setFlattenKeepLinks,
    flattenRasterize,
    setFlattenRasterize,
    flattenDpi,
    setFlattenDpi,
    flattenImageFormat,
    setFlattenImageFormat,
    flattenQuality,
    setFlattenQuality,
    flattenPrintedOnly,
    setFlattenPrintedOnly,
  };
}

export type FlattenState = ReturnType<typeof useFlattenState>;
