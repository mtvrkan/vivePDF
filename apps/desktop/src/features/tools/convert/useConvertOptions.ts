import { useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { ImageFit, ImageFormat, MarkdownPictures, PptxMode, XlsxFormat, XlsxSheets } from "@/types";
import { EBOOK_EXTENSIONS, IMAGE_EXTENSIONS, MAIL_EXTENSIONS, OFFICE_LIKE_EXTENSIONS, SVG_EXTENSIONS, TEXT_LIKE_EXTENSIONS } from "./conversions";

export function useConvertOptions() {
  const { t } = useTranslation();
  const [format, setFormat] = useState<ImageFormat>("png");
  const [dpi, setDpi] = useState(150);
  const [quality, setQuality] = useState(88);
  const [layout, setLayout] = useState(false);
  const [paper, setPaper] = useState<"a4" | "letter">("a4");
  const [images, setImages] = useState<string[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [recursive, setRecursive] = useState(false);
  const [sort, setSort] = useState<"name" | "date">("name");
  const [pageSize, setPageSize] = useState<"image" | "a4" | "letter">("a4");
  const [orientation, setOrientation] = useState<"auto" | "portrait" | "landscape">("auto");
  const [margin, setMargin] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const [svgFiles, setSvgFiles] = useState<string[]>([]);
  const [combineSvg, setCombineSvg] = useState(false);
  const [url, setUrl] = useState("");
  const [readerMode, setReaderMode] = useState(true);
  const [includeImages, setIncludeImages] = useState(true);
  const [split, setSplit] = useState<"auto" | "chapter" | "page">("auto");
  const [bookTitle, setBookTitle] = useState("");
  const [bookAuthor, setBookAuthor] = useState("");
  const [sheets, setSheets] = useState<XlsxSheets>("table");
  const [xlsxFormat, setXlsxFormat] = useState<XlsxFormat>("xlsx");
  const [borderless, setBorderless] = useState(false);
  const [single, setSingle] = useState(false);
  const [transparent, setTransparent] = useState(false);
  const [gray, setGray] = useState(false);
  const [archive, setArchive] = useState(false);
  const [ocr, setOcr] = useState(false);
  const [pictures, setPictures] = useState<MarkdownPictures>("none");
  const [headerFooter, setHeaderFooter] = useState(true);
  const [fit, setFit] = useState<ImageFit>("fit");
  const [cover, setCover] = useState(true);
  const [pptxMode, setPptxMode] = useState<PptxMode>("editable");

  const addImages = async () => {
    const selected = await openDialog({ multiple: true, directory: false, filters: [{ name: t("tools.scan.photo.images"), extensions: IMAGE_EXTENSIONS }] });
    if (!selected) return;
    setImages((state) => [...state, ...(Array.isArray(selected) ? selected : [selected]).filter((item) => !state.includes(item))]);
  };

  const addFolder = async () => {
    const selected = await openDialog({ directory: true, multiple: true });
    if (!selected) return;
    setFolders((state) => [...state, ...(Array.isArray(selected) ? selected : [selected]).filter((item) => !state.includes(item))]);
  };

  const addFiles = async () => {
    const selected = await openDialog({
      multiple: true,
      directory: false,
      filters: [{ name: t("tools.convert.anyDocument"), extensions: [...OFFICE_LIKE_EXTENSIONS, ...TEXT_LIKE_EXTENSIONS, ...EBOOK_EXTENSIONS, ...MAIL_EXTENSIONS, ...IMAGE_EXTENSIONS] }],
    });
    if (!selected) return;
    setFiles((state) => [...state, ...(Array.isArray(selected) ? selected : [selected]).filter((item) => !state.includes(item))]);
  };

  const addSvgFiles = async () => {
    const selected = await openDialog({ multiple: true, directory: false, filters: [{ name: t("tools.convert.svgFilter"), extensions: SVG_EXTENSIONS }] });
    if (!selected) return;
    setSvgFiles((state) => [...state, ...(Array.isArray(selected) ? selected : [selected]).filter((item) => !state.includes(item))]);
  };

  return {
    format,
    setFormat,
    dpi,
    setDpi,
    quality,
    setQuality,
    layout,
    setLayout,
    paper,
    setPaper,
    images,
    setImages,
    folders,
    setFolders,
    recursive,
    setRecursive,
    sort,
    setSort,
    pageSize,
    setPageSize,
    orientation,
    setOrientation,
    margin,
    setMargin,
    files,
    setFiles,
    svgFiles,
    setSvgFiles,
    combineSvg,
    setCombineSvg,
    url,
    setUrl,
    readerMode,
    setReaderMode,
    includeImages,
    setIncludeImages,
    split,
    setSplit,
    bookTitle,
    setBookTitle,
    bookAuthor,
    setBookAuthor,
    sheets,
    setSheets,
    xlsxFormat,
    setXlsxFormat,
    borderless,
    setBorderless,
    single,
    setSingle,
    transparent,
    setTransparent,
    gray,
    setGray,
    archive,
    setArchive,
    ocr,
    setOcr,
    pictures,
    setPictures,
    headerFooter,
    setHeaderFooter,
    fit,
    setFit,
    cover,
    setCover,
    pptxMode,
    setPptxMode,
    addImages,
    addFolder,
    addFiles,
    addSvgFiles,
  };
}

export type ConvertOptions = ReturnType<typeof useConvertOptions>;
