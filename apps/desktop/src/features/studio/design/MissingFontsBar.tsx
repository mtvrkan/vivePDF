import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/shared/Button";
import { describeError } from "@/shared/lib/errorMessage";
import { formatBytes } from "@/shared/lib/format";
import { toRpcError } from "@/shared/rpc/client";
import { downloadLibraryFont, fontLibrary } from "@/shared/rpc/operations";
import { useFontLibraryStore } from "@/shared/store/fontLibraryStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useUiStore } from "@/shared/store/uiStore";
import type { FontLibraryFamily } from "@/types";
import { libraryFontIds } from "../model/design";
import { useStudioStore } from "./studioStore";

export function MissingFontsBar() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const fontIds = useStudioStore(useShallow((state) => libraryFontIds(state.design)));
  const revision = useFontLibraryStore((state) => state.revision);
  const [missing, setMissing] = useState<FontLibraryFamily[]>([]);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let live = true;
    if (!fontIds.length) {
      setMissing([]);
      return;
    }
    fontLibrary().then(
      (result) => {
        if (live) setMissing(result.families.filter((family) => fontIds.includes(family.id) && !family.installed));
      },
      () => {
        if (live) setMissing([]);
      },
    );
    return () => {
      live = false;
    };
  }, [fontIds, revision]);

  if (!missing.length) return null;
  const size = missing.reduce((total, family) => total + family.bytes, 0);

  const download = async () => {
    setDownloading(true);
    try {
      for (const family of missing) await downloadLibraryFont({ id: family.id });
    } catch (error) {
      useToastStore.getState().push("error", describeError(t, toRpcError(error)));
    } finally {
      setDownloading(false);
      useFontLibraryStore.getState().changed();
    }
  };

  return (
    <div role="status" data-testid="studio-missing-fonts" className="glass-flat flex h-9 shrink-0 items-center gap-2 border-b px-3 text-xs">
      <Download className="size-4 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{t("studio.fonts.missing", { names: missing.map((family) => family.name).join(", ") })}</span>
      <Button size="sm" variant="ghost" loading={downloading} onClick={() => void download()}>
        {t("studio.fonts.download", { size: formatBytes(size, locale) })}
      </Button>
    </div>
  );
}
