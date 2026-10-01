import { useEffect, useState } from "react";
import { Minimize2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Checkbox, Field, OptionCards, Section, SliderField, TextInput } from "@/components/tool/form";
import { OutputPathField } from "@/components/tool/OutputPathField";
import { ResultPanel } from "@/components/tool/ResultPanel";
import { SourcePicker } from "@/components/tool/SourcePicker";
import { ToolLayout } from "@/components/tool/ToolLayout";
import { useOperation } from "@/shared/hooks/useOperation";
import { useSourceDocument } from "@/shared/hooks/useSourceDocument";
import { formatBytes } from "@/shared/lib/format";
import { suggestOutputPath } from "@/shared/lib/paths";
import { compressPdf, inspectSpace } from "@/shared/rpc/operations";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import { useUiStore } from "@/shared/store/uiStore";
import type { CompressProfile, SpaceReport } from "@/types";
import { CompressPreview } from "./CompressPreview";
import { PROFILES, profileLabelKey } from "./compressProfiles";
import { LargestItems } from "./LargestItems";
import { SpaceBar } from "./SpaceBar";

const CUSTOM_DPI = { min: 36, max: 600, initial: 150 };
const CUSTOM_QUALITY = { min: 10, max: 95, initial: 75 };

export function CompressPage() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const sourceState = useSourceDocument();
  const operation = useOperation(compressPdf);
  const [profile, setProfile] = useState<CompressProfile>(() => usePreferencesStore.getState().compressProfile);
  const [grayscale, setGrayscale] = useState(false);
  const [stripMetadata, setStripMetadata] = useState(false);
  const [discardExtras, setDiscardExtras] = useState(false);
  const [linearize, setLinearize] = useState(false);
  const [customDpi, setCustomDpi] = useState(CUSTOM_DPI.initial);
  const [customQuality, setCustomQuality] = useState(CUSTOM_QUALITY.initial);
  const [removeAttachments, setRemoveAttachments] = useState(false);
  const [removeComments, setRemoveComments] = useState(false);
  const [removeScripts, setRemoveScripts] = useState(false);
  const [useTarget, setUseTarget] = useState(false);
  const [targetMb, setTargetMb] = useState("2");
  const [output, setOutput] = useState("");
  const targetBytes = useTarget ? Math.round(Number(targetMb.replace(",", ".")) * 1024 * 1024) : undefined;
  const targetValid = !useTarget || (targetBytes !== undefined && Number.isFinite(targetBytes) && targetBytes >= 10_000);

  const source = sourceState.source;
  const [space, setSpace] = useState<SpaceReport | null>(null);
  const [spaceFailed, setSpaceFailed] = useState(false);

  useEffect(() => {
    setSpace(null);
    setSpaceFailed(false);
    if (!source?.info) return;
    let live = true;
    void inspectSpace({ path: source.path, password: source.password ?? undefined })
      .then((report) => {
        if (live) setSpace(report);
      })
      .catch(() => {
        if (live) setSpaceFailed(true);
      });
    return () => {
      live = false;
    };
  }, [source?.path, source?.info, source?.password]);

  const sourcePath = source?.path;
  const suffix = t("tools.compress.suffix");
  useEffect(() => {
    if (sourcePath) setOutput(suggestOutputPath(sourcePath, suffix));
  }, [sourcePath, suffix]);

  const run = () => {
    if (!source?.info || !output) return;
    void operation.run({
      path: source.path,
      password: source.password ?? undefined,
      output,
      profile,
      grayscale,
      stripMetadata,
      discardExtras,
      linearize,
      targetBytes: targetValid ? targetBytes : undefined,
      customDpi,
      customQuality,
      removeAttachments,
      removeComments,
      removeScripts,
    });
  };

  const result = operation.result;
  const saved = result ? Math.round((1 - result.bytesAfter / result.bytesBefore) * 100) : 0;
  const captionParts = result
    ? [
        `${formatBytes(result.bytesBefore, locale)} → ${formatBytes(result.bytesAfter, locale)}`,
        result.keptOriginal ? t("tools.compress.keptOriginal") : "",
        result.targetBytes && profileLabelKey(result.profileUsed) ? t("tools.compress.profileUsed", { profile: t(profileLabelKey(result.profileUsed) ?? "") }) : "",
        result.privacyOnly ? t("tools.compress.privacyOnly") : "",
        result.grew ? t("tools.compress.grew") : "",
        result.linearized ? t("tools.compress.linearized") : "",
        result.fontBytesSaved ? t("tools.compress.fontsSlimmed", { size: formatBytes(result.fontBytesSaved, locale) }) : "",
        result.attachmentsRemoved ? t("tools.compress.cleanup.attachmentsRemoved", { count: result.attachmentsRemoved }) : "",
        result.commentsRemoved ? t("tools.compress.cleanup.commentsRemoved", { count: result.commentsRemoved }) : "",
        result.scriptsRemoved ? t("tools.compress.cleanup.scriptsRemoved", { count: result.scriptsRemoved }) : "",
        result.targetBytes ? (result.targetMet ? t("tools.compress.targetMet") : t("tools.compress.targetMissed", { size: formatBytes(result.targetBytes, locale) })) : "",
      ].filter(Boolean)
    : [];

  return (
    <ToolLayout
      title={t("nav.compress")}
      icon={Minimize2}
      description={t("tools.compress.description")}
      actions={
        <Button variant="primary" onClick={run} loading={operation.running} disabled={!source?.info || !output || !targetValid}>
          {t("tools.compress.run")}
        </Button>
      }
      form={
        <>
          <SourcePicker {...sourceState} onPick={() => void sourceState.pick()} onPassword={(password) => void sourceState.submitPassword(password)} disabled={operation.running} />
          <fieldset disabled={operation.running} className="contents">
            {space ? (
              <Section title={t("tools.compress.space.title")}>
                <SpaceBar report={space} />
                {space.squeezableShare < 0.25 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("tools.compress.space.little", { percent: Math.round(space.squeezableShare * 100) })}
                  </p>
                ) : null}
                <LargestItems images={space.largestImages ?? []} fonts={space.largestFonts ?? []} />
              </Section>
            ) : source?.info && !spaceFailed ? (
              <Section title={t("tools.compress.space.title")}>
                <div role="status" aria-label={t("tools.compress.space.measuring")} className="space-y-2">
                  <div className="h-3 animate-pulse rounded-full bg-secondary/70" />
                  <div className="h-4 w-2/3 animate-pulse rounded-md bg-secondary/70" />
                </div>
              </Section>
            ) : null}
            <Section title={t("tools.compress.profile")}>
              <Checkbox label={t("tools.compress.targetSize")} hint={t("tools.compress.targetSizeHint")} checked={useTarget} onChange={setUseTarget} />
              {useTarget ? (
                <Field label={t("tools.compress.targetMb")} note={targetValid ? undefined : <p className="mt-1.5 text-xs text-destructive" role="alert">{t("tools.compress.targetInvalid")}</p>}>
                  <TextInput type="number" min={0.01} step={0.1} value={targetMb} onChange={(event) => setTargetMb(event.target.value)} className="w-32 font-mono" aria-label={t("tools.compress.targetMb")} aria-invalid={!targetValid || undefined} />
                </Field>
              ) : (
                <OptionCards
                  value={profile}
                  onChange={setProfile}
                  ariaLabel={t("tools.compress.profile")}
                  options={PROFILES.map((value) => ({
                    value,
                    title: t(`tools.compress.profiles.${value}.title`),
                    description: t(`tools.compress.profiles.${value}.description`),
                  }))}
                />
              )}
              {!useTarget && profile === "custom" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <SliderField label={t("tools.compress.custom.dpi")} hint={t("tools.compress.custom.dpiHint")} value={customDpi} min={CUSTOM_DPI.min} max={CUSTOM_DPI.max} step={6} onChange={setCustomDpi} format={(value) => t("tools.compress.largest.dpi", { dpi: value })} />
                  <SliderField label={t("tools.compress.custom.quality")} hint={t("tools.compress.custom.qualityHint")} value={customQuality} min={CUSTOM_QUALITY.min} max={CUSTOM_QUALITY.max} onChange={setCustomQuality} />
                </div>
              ) : null}
              <Checkbox label={t("tools.compress.grayscale")} checked={grayscale} onChange={setGrayscale} />
              <Checkbox label={t("tools.compress.linearize")} hint={t("tools.compress.linearizeHint")} checked={linearize} onChange={setLinearize} />
            </Section>
            {source?.info && !useTarget ? (
              <Section title={t("tools.compress.preview.title")}>
                <CompressPreview
                  key={source.path}
                  settings={{ path: source.path, password: source.password ?? undefined, profile, customDpi, customQuality, grayscale }}
                  pageCount={source.info.pageCount}
                  disabled={operation.running}
                />
              </Section>
            ) : null}
            <Section title={t("tools.compress.cleanup.title")}>
              <Checkbox label={t("tools.compress.stripMetadata")} checked={stripMetadata} onChange={setStripMetadata} />
              <Checkbox label={t("tools.compress.discardExtras")} hint={t("tools.compress.discardExtrasHint")} checked={discardExtras} onChange={setDiscardExtras} />
              <Checkbox label={t("tools.compress.cleanup.attachments")} hint={t("tools.compress.cleanup.attachmentsHint")} checked={removeAttachments} onChange={setRemoveAttachments} />
              <Checkbox label={t("tools.compress.cleanup.comments")} hint={t("tools.compress.cleanup.commentsHint")} checked={removeComments} onChange={setRemoveComments} />
              <Checkbox label={t("tools.compress.cleanup.scripts")} hint={t("tools.compress.cleanup.scriptsHint")} checked={removeScripts} onChange={setRemoveScripts} />
            </Section>
            <Section>
              <OutputPathField value={output} onChange={setOutput} disabled={operation.running} />
            </Section>
          </fieldset>
        </>
      }
      result={
        <ResultPanel
          sourcePath={source?.path}
          sourcePassword={source?.password ?? undefined}
          status={operation.status}
          progress={operation.progress}
          error={operation.error}
          numeral={result ? `${saved > 0 ? "−" : saved < 0 ? "+" : ""}${Math.abs(saved)}%` : undefined}
          caption={result ? captionParts.join(" · ") : undefined}
          outputs={result ? [result.output] : []}
          idleIcon={Minimize2}
          idleTitle={t("tools.compress.idle.title")}
          idleDescription={t("tools.compress.idle.description")}
          onCancel={operation.cancel}
          onRetry={run}
          overwritePrompt={operation.overwritePrompt}
          onConfirmOverwrite={operation.confirmOverwrite}
          onDismissOverwrite={operation.dismissOverwrite}
        />
      }
    />
  );
}
