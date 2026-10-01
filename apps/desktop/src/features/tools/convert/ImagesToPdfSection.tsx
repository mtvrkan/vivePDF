import { ArrowDown, ArrowUp, FolderPlus, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { Checkbox, Field, OptionCards, Section, SelectInput } from "@/components/tool/form";
import { FitPreview } from "@/components/tool/FitPreview";
import { FileDropArea } from "@/components/tool/FileDropArea";
import { OutputPathField } from "@/components/tool/OutputPathField";
import { basenameOf } from "@/shared/lib/paths";
import type { ImageFit } from "@/types";
import { moveItem } from "./conversions";
import type { ConvertOptions } from "./useConvertOptions";

export function ImagesToPdfSection({
  running,
  output,
  setOutput,
  options,
}: {
  running: boolean;
  output: string;
  setOutput: (value: string) => void;
  options: ConvertOptions;
}) {
  const { t } = useTranslation();
  const { images, setImages, folders, setFolders, sort, setSort, pageSize, setPageSize, orientation, setOrientation, fit, setFit, margin, setMargin, recursive, setRecursive, addImages, addFolder } = options;
  return (
    <>
      <Section title={t("tools.convert.imageSources")}>
        {images.length + folders.length === 0 ? (
          <FileDropArea title={t("tools.dropZone.images")} description={t("tools.convert.dropImages")} onPick={() => void addImages()} disabled={running} />
        ) : (
        <ul className="divide-y rounded-md border">
          {images.map((image, index) => (
            <li key={image} className="flex h-row items-center gap-2 px-2 text-sm">
              <span className="w-6 text-end font-mono text-xs text-muted-foreground">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate" title={image}>{basenameOf(image)}</span>
              <IconButton icon={ArrowUp} label={t("tools.scan.photo.moveUp", { name: basenameOf(image) })} disabled={index === 0 || running} onClick={() => setImages((state) => moveItem(state, index, -1))} />
              <IconButton icon={ArrowDown} label={t("tools.scan.photo.moveDown", { name: basenameOf(image) })} disabled={index === images.length - 1 || running} onClick={() => setImages((state) => moveItem(state, index, 1))} />
              <IconButton icon={X} label={t("common.removeNamed", { name: basenameOf(image) })} disabled={running} onClick={() => setImages((state) => state.filter((item) => item !== image))} />
            </li>
          ))}
          {folders.map((folder) => (
            <li key={folder} className="flex h-row items-center gap-2 px-2 text-sm">
              <FolderPlus className="size-4 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={folder}>{folder}</span>
              <IconButton icon={X} label={t("common.removeNamed", { name: basenameOf(folder) })} disabled={running} onClick={() => setFolders((state) => state.filter((item) => item !== folder))} />
            </li>
          ))}
        </ul>
        )}
        <div className="flex gap-2">
          {images.length + folders.length > 0 ? (
            <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => void addImages()} disabled={running}>{t("tools.convert.addImages")}</Button>
          ) : null}
          <Button icon={<FolderPlus className="size-4" aria-hidden />} onClick={() => void addFolder()} disabled={running}>{t("tools.convert.addFolder")}</Button>
        </div>
        <div className="grid grid-cols-3 items-end gap-3">
          <Field label={t("tools.convert.folderOrder")}>
            <SelectInput value={sort} onChange={(event) => setSort(event.target.value as "name" | "date")} disabled={running || folders.length === 0}>
              <option value="name">{t("tools.convert.sortName")}</option>
              <option value="date">{t("tools.convert.sortDate")}</option>
            </SelectInput>
          </Field>
          <Field label={t("tools.pages.paperSize")}>
            <SelectInput value={pageSize} onChange={(event) => setPageSize(event.target.value as "image" | "a4" | "letter")} disabled={running}>
              <option value="a4">A4</option>
              <option value="letter">Letter</option>
              <option value="image">{t("tools.convert.imageSize")}</option>
            </SelectInput>
          </Field>
          <Field label={t("tools.pages.orientation")}>
            <SelectInput value={orientation} onChange={(event) => setOrientation(event.target.value as "auto" | "portrait" | "landscape")} disabled={running || pageSize === "image"}>
              <option value="auto">{t("tools.convert.orientationAuto")}</option>
              <option value="portrait">{t("tools.pages.portrait")}</option>
              <option value="landscape">{t("tools.pages.landscape")}</option>
            </SelectInput>
          </Field>
        </div>
        <OptionCards
          value={fit}
          onChange={setFit}
          ariaLabel={t("tools.convert.fit")}
          disabled={running}
          options={(["fit", "fill"] as ImageFit[]).map((value) => ({
            value,
            title: t(`tools.convert.fitModes.${value}`),
            description: t(`tools.convert.fitHints.${value}`),
            preview: <FitPreview mode={value} />,
          }))}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label={`${t("tools.convert.margin")} · ${margin} pt`}>
            <input type="range" min={0} max={72} value={margin} onChange={(event) => setMargin(Number(event.target.value))} className="w-full accent-primary disabled:opacity-50" aria-label={t("tools.convert.margin")} disabled={running} />
          </Field>
          <div className="flex items-end pb-1">
            <Checkbox label={t("tools.convert.recursive")} checked={recursive} onChange={setRecursive} disabled={running || folders.length === 0} />
          </div>
        </div>
      </Section>
      <Section>
        <OutputPathField value={output} onChange={setOutput} disabled={running} />
      </Section>
    </>
  );
}
