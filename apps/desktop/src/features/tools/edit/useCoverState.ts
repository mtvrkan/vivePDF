import { useEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { DEFAULT_ACCENT, LOGO_EXTENSIONS, longDate } from "@/features/tools/create/createDocument";
import { useUiStore } from "@/shared/store/uiStore";
import type { CoverStyle, CreateFont, SourceDocument } from "@/types";
import { COVER_PHOTO_EXTENSIONS, coverDefaults, type CoverTextField, type CoverTexts } from "./coverShared";

export function useCoverState(source: SourceDocument | null) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const [style, setStyle] = useState<CoverStyle>("classic");
  const [texts, setTexts] = useState<CoverTexts>(() => ({ title: "", subtitle: "", organisation: "", author: "", details: "", date: longDate(new Date(), locale) }));
  const [logo, setLogo] = useState<string | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [accent, setAccent] = useState(DEFAULT_ACCENT);
  const [font, setFont] = useState<CreateFont>("sans");
  const [replaceFirst, setReplaceFirst] = useState(false);
  const filledFor = useRef<string | null>(null);

  useEffect(() => {
    if (!source?.info || filledFor.current === source.path) return;
    filledFor.current = source.path;
    const defaults = coverDefaults(source);
    setTexts((current) => ({ ...current, title: defaults.title, author: current.author || defaults.author }));
  }, [source]);

  const setText = (field: CoverTextField, value: string) => setTexts((current) => ({ ...current, [field]: value }));

  const pick = async (which: "logo" | "image") => {
    const extensions = which === "logo" ? LOGO_EXTENSIONS : COVER_PHOTO_EXTENSIONS;
    const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: t("tools.create.logoFiles"), extensions }] });
    if (typeof selected !== "string") return;
    if (which === "logo") setLogo(selected);
    else setImage(selected);
  };

  const chooseStyle = (next: CoverStyle) => {
    setStyle(next);
    if (next === "frame") setFont("serif");
  };

  const coverValid = texts.title.trim().length > 0 && (style !== "photo" || image !== null);

  return { style, chooseStyle, texts, setText, logo, setLogo, image, setImage, accent, setAccent, font, setFont, replaceFirst, setReplaceFirst, pick, coverValid };
}

export type CoverState = ReturnType<typeof useCoverState>;
