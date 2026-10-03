import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { IconButton } from "@/components/shared/IconButton";
import { Select, type SelectOption } from "@/components/shared/Select";
import { toRpcError } from "@/shared/rpc/client";
import { addFont, downloadLibraryFont, fontCatalogue, removeFont, removeLibraryFont } from "@/shared/rpc/operations";
import { describeError } from "@/shared/lib/errorMessage";
import { formatBytes } from "@/shared/lib/format";
import { useFontLibraryStore } from "@/shared/store/fontLibraryStore";
import { useToastStore } from "@/shared/store/toastStore";
import { useUiStore } from "@/shared/store/uiStore";
import type { FontChoice } from "@/types";

const DEFAULT_FONT = "bundled:dejavu-sans";
const SEPARATOR = "__group__";

export function FontPicker({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  const toast = useToastStore((state) => state.push);
  const [fonts, setFonts] = useState<FontChoice[]>([]);
  const [busy, setBusy] = useState(false);
  const revision = useFontLibraryStore((state) => state.revision);
  const locale = useUiStore((state) => state.locale);

  const load = useCallback(async () => {
    try {
      const result = await fontCatalogue();
      setFonts(result.fonts);
    } catch (error) {
      toast("error", describeError(t, toRpcError(error)));
    }
  }, [t, toast]);

  useEffect(() => {
    void load();
  }, [load, revision]);

  const groups: Array<{ key: "bundled" | "library" | "imported" | "system"; items: FontChoice[] }> = [
    { key: "bundled", items: fonts.filter((font) => font.source === "bundled") },
    { key: "library", items: fonts.filter((font) => font.source === "library") },
    { key: "imported", items: fonts.filter((font) => font.source === "imported") },
    { key: "system", items: fonts.filter((font) => font.source === "system") },
  ];
  const options: SelectOption[] = groups.flatMap(({ key, items }) =>
    items.length === 0
      ? []
      : [
          { value: `${SEPARATOR}${key}`, label: t(`fontPicker.groups.${key}`), disabled: true },
          ...items.map((font) => ({
            value: font.id,
            label: font.installed === false ? t("fontPicker.toDownload", { name: font.name, size: formatBytes(font.bytes ?? 0, locale) }) : font.name,
          })),
        ],
  );
  const selected = fonts.find((font) => font.id === value);

  const pick = async () => {
    const chosen = await openDialog({ multiple: false, directory: false, filters: [{ name: "Font", extensions: ["ttf", "otf"] }] });
    if (typeof chosen !== "string") return;
    setBusy(true);
    try {
      const added = await addFont({ path: chosen });
      await load();
      onChange(added.id);
      toast("success", t("fontPicker.added", { name: added.name }));
    } catch (error) {
      toast("error", describeError(t, toRpcError(error)));
    } finally {
      setBusy(false);
    }
  };

  const choose = async (next: string) => {
    const font = fonts.find((item) => item.id === next);
    if (font?.source !== "library" || font.installed !== false) {
      onChange(next);
      return;
    }
    setBusy(true);
    try {
      await downloadLibraryFont({ id: font.id });
      useFontLibraryStore.getState().changed();
      onChange(font.id);
      toast("success", t("fontPicker.downloaded", { name: font.name }));
    } catch (error) {
      toast("error", describeError(t, toRpcError(error)));
    } finally {
      setBusy(false);
    }
  };

  const drop = async () => {
    if (!selected || (selected.source !== "imported" && !(selected.source === "library" && selected.installed))) return;
    setBusy(true);
    try {
      if (selected.source === "library") await removeLibraryFont({ id: selected.id });
      else await removeFont({ id: selected.id });
      if (selected.source === "library") useFontLibraryStore.getState().changed();
      onChange(DEFAULT_FONT);
      await load();
    } catch (error) {
      toast("error", describeError(t, toRpcError(error)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex gap-2">
      <Select
        value={value}
        options={options}
        onChange={(next) => {
          if (!next.startsWith(SEPARATOR)) void choose(next);
        }}
        disabled={disabled || busy}
        ariaLabel={t("fontPicker.label")}
        searchable
        searchPlaceholder={t("fontPicker.search")}
        emptyLabel={t("fontPicker.noMatch")}
        className="min-w-0 flex-1"
      />
      <IconButton icon={Plus} label={t("fontPicker.add")} onClick={() => void pick()} disabled={disabled || busy} />
      {selected?.source === "imported" || (selected?.source === "library" && selected.installed) ? (
        <IconButton icon={Trash2} label={t(selected.source === "library" ? "fontPicker.removeDownload" : "fontPicker.remove")} onClick={() => void drop()} disabled={disabled || busy} />
      ) : null}
    </div>
  );
}
