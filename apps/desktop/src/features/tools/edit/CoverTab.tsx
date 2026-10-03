import { ImagePlus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { ColorSwatch } from "@/components/shared/ColorSwatch";
import { IconButton } from "@/components/shared/IconButton";
import { Checkbox, Field, OptionCards, Section, Segmented, TextArea, TextInput } from "@/components/tool/form";
import { CREATE_FONTS } from "@/features/tools/create/createDocument";
import { Group } from "@/features/tools/create/Group";
import { basenameOf } from "@/shared/lib/paths";
import { COVER_STYLES, type CoverTextField } from "./coverShared";
import type { CoverState } from "./useCoverState";

const MULTILINE: CoverTextField[] = ["organisation", "details"];

function PictureField({ label, hint, path, onPick, onClear, pickLabel, clearLabel }: { label: string; hint?: string; path: string | null; onPick: () => void; onClear: () => void; pickLabel: string; clearLabel: string }) {
  return (
    <Group label={label} hint={hint}>
      {path ? (
        <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <ImagePlus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate" title={path}>
            {basenameOf(path)}
          </span>
          <IconButton icon={X} label={clearLabel} onClick={onClear} />
        </div>
      ) : (
        <Button size="sm" icon={<ImagePlus className="size-4" aria-hidden />} onClick={onPick}>
          {pickLabel}
        </Button>
      )}
    </Group>
  );
}

export function CoverTab({ state }: { state: CoverState }) {
  const { t } = useTranslation();
  const { style, chooseStyle, texts, setText, logo, setLogo, image, setImage, accent, setAccent, font, setFont, replaceFirst, setReplaceFirst, pick } = state;

  const textField = (field: CoverTextField) => {
    const label = t(`tools.edit.cover.fields.${field}`);
    const placeholder = t(`tools.edit.cover.examples.${field}`);
    return (
      <Field key={field} label={label}>
        {MULTILINE.includes(field) ? (
          <TextArea rows={2} maxLength={field === "details" ? 1000 : 500} value={texts[field]} placeholder={placeholder} onChange={(event) => setText(field, event.target.value)} aria-label={label} />
        ) : (
          <TextInput maxLength={field === "date" ? 80 : 300} value={texts[field]} placeholder={placeholder} onChange={(event) => setText(field, event.target.value)} aria-label={label} />
        )}
      </Field>
    );
  };

  return (
    <>
      <Section title={t("tools.edit.cover.style")}>
        <OptionCards
          value={style}
          onChange={chooseStyle}
          ariaLabel={t("tools.edit.cover.style")}
          options={COVER_STYLES.map((value) => ({ value, title: t(`tools.edit.cover.styles.${value}.title`), description: t(`tools.edit.cover.styles.${value}.description`) }))}
        />
      </Section>
      <Section title={t("tools.edit.cover.texts")}>
        {textField("title")}
        {textField("subtitle")}
        <div className="grid gap-3 sm:grid-cols-2">
          {textField("organisation")}
          {textField("details")}
          {textField("author")}
          {textField("date")}
        </div>
      </Section>
      <Section title={t("tools.create.look")}>
        <Field label={t("tools.create.font")}>
          <Segmented value={font} options={CREATE_FONTS} labelOf={(value) => t(`tools.create.fonts.${value}`)} onChange={setFont} ariaLabel={t("tools.create.font")} />
        </Field>
        <Group label={t("tools.create.accent")}>
          <ColorSwatch value={accent} onChange={setAccent} label={t("tools.create.accent")} customLabel={t("tools.create.customColor")} />
        </Group>
        <PictureField label={t("tools.create.logo")} path={logo} onPick={() => void pick("logo")} onClear={() => setLogo(null)} pickLabel={t("tools.create.pickLogo")} clearLabel={t("tools.create.removeLogo")} />
        {style === "photo" ? (
          <PictureField
            label={t("tools.edit.cover.image")}
            hint={t("tools.edit.cover.imageHint")}
            path={image}
            onPick={() => void pick("image")}
            onClear={() => setImage(null)}
            pickLabel={t("tools.edit.cover.pickImage")}
            clearLabel={t("tools.edit.cover.removeImage")}
          />
        ) : null}
        <Checkbox label={t("tools.edit.cover.replaceFirst")} hint={t("tools.edit.cover.replaceFirstHint")} checked={replaceFirst} onChange={setReplaceFirst} />
      </Section>
    </>
  );
}
