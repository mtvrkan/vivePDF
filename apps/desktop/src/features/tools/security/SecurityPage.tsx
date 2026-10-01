import { useEffect, useState } from "react";
import { Info, ShieldCheck, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Section } from "@/components/tool/form";
import { OutputPathField } from "@/components/tool/OutputPathField";
import { ResultPanel } from "@/components/tool/ResultPanel";
import { SourcePicker } from "@/components/tool/SourcePicker";
import { ToolLayout } from "@/components/tool/ToolLayout";
import { CertificateOpenSection } from "@/features/tools/security/CertificateOpenSection";
import { CertificateSealSection } from "@/features/tools/security/CertificateSealSection";
import { DecryptSection } from "@/features/tools/security/DecryptSection";
import { EncryptSection, GeneratedOwnerPassword } from "@/features/tools/security/EncryptSection";
import { MarkPresets } from "@/features/tools/security/MarkPresets";
import { stampMarkParams, watermarkHasContent, watermarkMarkParams } from "@/features/tools/security/markParams";
import { MarkPreview, type MarkRequest } from "@/features/tools/security/MarkPreview";
import { isRestricted } from "@/features/tools/security/permissionSets";
import { PrivacySection } from "@/features/tools/security/PrivacySection";
import { RemoveWatermarkSection } from "@/features/tools/security/RemoveWatermarkSection";
import { StampSection } from "@/features/tools/security/StampSection";
import { WatermarkSection } from "@/features/tools/security/WatermarkSection";
import { isReady, removedTotal, sealAlgorithm, SECURITY_TABS, type SecurityTab } from "@/features/tools/security/securityForm";
import { runSecurity } from "@/features/tools/security/securityRun";
import { useEncryptForm } from "@/features/tools/security/useEncryptForm";
import { useMarkPresets } from "@/features/tools/security/useMarkPresets";
import { usePrivacyScan } from "@/features/tools/security/usePrivacyScan";
import { useStampForm } from "@/features/tools/security/useStampForm";
import { useWatermarkForm } from "@/features/tools/security/useWatermarkForm";
import { useWatermarkRemoval } from "@/features/tools/security/useWatermarkRemoval";
import { useOperation } from "@/shared/hooks/useOperation";
import { useSourceDocument } from "@/shared/hooks/useSourceDocument";
import { useTabParam } from "@/shared/hooks/useTabParam";
import { formatNumber } from "@/shared/lib/format";
import { suggestOutputPath } from "@/shared/lib/paths";
import { useUiStore } from "@/shared/store/uiStore";

export function SecurityPage() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const sourceState = useSourceDocument();
  const operation = useOperation(runSecurity);
  const [tab] = useTabParam<SecurityTab>(SECURITY_TABS, "encrypt");
  const [output, setOutput] = useState("");
  const {
    userPassword,
    setUserPassword,
    encryptMetadata,
    setEncryptMetadata,
    recipients,
    setRecipients,
    sealedPath,
    setSealedPath,
    holderPath,
    setHolderPath,
    holderPassword,
    setHolderPassword,
    ownerPassword,
    setOwnerPassword,
    confirmPassword,
    setConfirmPassword,
    algorithm,
    setAlgorithm,
    permissions,
    setPermissions,
    decryptPassword,
    setDecryptPassword,
    resetSecrets,
  } = useEncryptForm();
  const watermark = useWatermarkForm();
  const { kind, templatePath, text, imagePath, flatten, flattenDpi, visibility } = watermark.form;
  const stamp = useStampForm();
  const { stampText } = stamp.form;
  const { tabPresets, presetName, setPresetName, savePreset, dropPreset, applyPreset } = useMarkPresets(tab, watermark, stamp);

  const source = sourceState.source;
  const sourcePath = source?.path ?? null;
  const sourcePassword = source?.password ?? undefined;

  useEffect(() => {
    const path = tab === "decryptCertificate" ? sealedPath : source?.path;
    if (path) setOutput(suggestOutputPath(path, t(`tools.security.${tab}.suffix`)));
  }, [source, sealedPath, tab, t]);

  const resetOperation = operation.reset;

  useEffect(() => {
    resetOperation();
    resetSecrets();
  }, [tab, resetOperation, resetSecrets]);

  useEffect(() => {
    if (operation.result) resetSecrets();
  }, [operation.result, resetSecrets]);

  const { report, scanning, scanError, scan, sanitizeOptions, setSanitizeOptions } = usePrivacyScan({ tab, sourcePath, sourcePassword, info: source?.info });

  const {
    removeText,
    setRemoveText,
    removeAnnotations,
    setRemoveAnnotations,
    removeImages,
    setRemoveImages,
    removePages,
    setRemovePages,
    found,
    chosen,
    setChosen,
    finding,
    findError,
    pagesScanned,
    findWatermarks,
    chosenCandidates,
    chosenTexts,
    chosenDigests,
    chosenAnnotations,
    chosenStampAnnotations,
    chosenTagged,
    chosenArtifacts,
    chosenLayers,
    chosenRaster,
  } = useWatermarkRemoval({ tab, sourcePath, sourcePassword, info: source?.info });

  const ready = isReady(tab, {
    hasDocument: !!source?.info,
    hasSource: !!source,
    documentPassword: !!source?.password,
    ownerOnly: !!source?.info?.ownerOnly,
    output,
    userPassword,
    ownerPassword,
    confirmPassword,
    algorithm,
    permissionsRestricted: isRestricted(permissions),
    recipients: recipients.length,
    decryptPassword,
    sealedPath,
    holderPath,
    kind,
    text,
    imagePath,
    templatePath,
    stampText,
    removeText,
    chosenCandidates: chosenCandidates.length,
    scanned: found !== null,
    removeAnnotations,
    removeImages,
    report,
    sanitizeOptions,
  });

  const previewRequest = (): MarkRequest | null => {
    if (!source?.info || !sourcePath) return null;
    const markSource = { path: sourcePath, password: sourcePassword };
    if (tab === "watermark") {
      if (!watermarkHasContent(watermark.form)) return null;
      return { kind: "watermark", params: watermarkMarkParams(watermark.form, markSource) };
    }
    if (tab === "stamp") {
      if (stampText.trim().length === 0) return null;
      return { kind: "stamp", params: stampMarkParams(stamp.form, markSource) };
    }
    return null;
  };

  const run = () => {
    if (!ready) return;
    if (tab === "decryptCertificate") {
      void operation.run({ tab, params: { path: sealedPath, output, certificatePath: holderPath, certificatePassword: holderPassword || undefined } });
      return;
    }
    if (!source) return;
    const base = { path: source.path, output };
    const markSource = { path: source.path, password: source.password ?? undefined };
    if (tab === "privacy") {
      void operation.run({ tab, params: { ...base, password: source.password ?? undefined, ...sanitizeOptions } });
    } else if (tab === "encrypt") {
      void operation.run({ tab, params: { ...base, password: source.password ?? undefined, userPassword, ownerPassword, algorithm, permissions, encryptMetadata } });
    } else if (tab === "certificate") {
      void operation.run({ tab, params: { ...base, password: source.password ?? undefined, certificates: recipients, algorithm: sealAlgorithm(algorithm), permissions, encryptMetadata } });
    } else if (tab === "decrypt") {
      void operation.run({ tab, params: { ...base, password: decryptPassword || source.password || undefined } });
    } else if (tab === "stamp") {
      void operation.run({ tab, params: { ...stampMarkParams(stamp.form, markSource), output } });
    } else if (tab === "removeWatermark") {
      void operation.run({
        tab,
        params: {
          ...base,
          password: source.password ?? undefined,
          text: removeText.trim() || undefined,
          texts: chosenTexts,
          annotations: found === null ? removeAnnotations : chosenAnnotations,
          stampAnnotations: found === null ? removeAnnotations : chosenStampAnnotations,
          repeatedImages: found === null ? removeImages : false,
          imageDigests: chosenDigests,
          tagged: chosenTagged,
          artifacts: chosenArtifacts,
          layers: chosenLayers,
          raster: chosenRaster,
          pages: removePages.trim() || undefined,
        },
      });
    } else {
      void operation.run({ tab, params: { ...watermarkMarkParams(watermark.form, markSource), output, flatten, flattenDpi, visibility } });
    }
  };

  const preview = previewRequest();
  const markPresets = <MarkPresets items={tabPresets} name={presetName} onName={setPresetName} onApply={applyPreset} onDrop={dropPreset} onSave={savePreset} />;

  return (
    <ToolLayout
      title={t(`tools.security.${tab}.title`)}
      icon={ShieldCheck}
      actions={
        <Button variant="primary" onClick={run} loading={operation.running} disabled={!ready}>
          {t(`tools.security.${tab}.run`)}
        </Button>
      }
      form={
        <>
          {tab !== "decryptCertificate" ? (
            <SourcePicker {...sourceState} onPick={() => void sourceState.pick()} onPassword={(password) => void sourceState.submitPassword(password)} disabled={operation.running} />
          ) : null}

          {tab === "encrypt" ? (
            <EncryptSection
              userPassword={userPassword}
              onUserPassword={setUserPassword}
              confirmPassword={confirmPassword}
              onConfirmPassword={setConfirmPassword}
              ownerPassword={ownerPassword}
              onOwnerPassword={setOwnerPassword}
              algorithm={algorithm}
              onAlgorithm={setAlgorithm}
              encryptMetadata={encryptMetadata}
              onEncryptMetadata={setEncryptMetadata}
              permissions={permissions}
              onPermissions={setPermissions}
            />
          ) : null}

          {tab === "decrypt" ? <DecryptSection password={decryptPassword} onPassword={setDecryptPassword} documentHasPassword={!!source?.password} ownerOnly={!!source?.info?.ownerOnly} /> : null}

          {tab === "certificate" ? (
            <CertificateSealSection
              recipients={recipients}
              onRecipients={setRecipients}
              algorithm={algorithm}
              onAlgorithm={setAlgorithm}
              encryptMetadata={encryptMetadata}
              onEncryptMetadata={setEncryptMetadata}
              permissions={permissions}
              onPermissions={setPermissions}
            />
          ) : null}

          {tab === "decryptCertificate" ? (
            <CertificateOpenSection
              sealedPath={sealedPath}
              onSealedPath={setSealedPath}
              holderPath={holderPath}
              onHolderPath={setHolderPath}
              holderPassword={holderPassword}
              onHolderPassword={setHolderPassword}
            />
          ) : null}

          {tab === "watermark" ? (
            <WatermarkSection
              form={watermark.form}
              set={watermark.set}
              busy={operation.running}
              presets={markPresets}
            />
          ) : null}

          {tab === "stamp" ? (
            <StampSection
              form={stamp.form}
              set={stamp.set}
              busy={operation.running}
              presets={markPresets}
            />
          ) : null}

          {tab === "removeWatermark" ? (
            <RemoveWatermarkSection
              found={found}
              chosen={chosen}
              finding={finding}
              findError={findError}
              pagesScanned={pagesScanned}
              onRescan={() => void findWatermarks()}
              onToggle={(id, value) => setChosen((state) => ({ ...state, [id]: value }))}
              scanned={found !== null}
              removeText={removeText}
              onRemoveText={setRemoveText}
              removeAnnotations={found === null ? removeAnnotations : chosenAnnotations || chosenStampAnnotations}
              onRemoveAnnotations={setRemoveAnnotations}
              removeImages={found === null ? removeImages : false}
              onRemoveImages={setRemoveImages}
              removePages={removePages}
              onRemovePages={setRemovePages}
            />
          ) : null}

          {tab === "privacy" ? (
            <PrivacySection
              report={report}
              scanning={scanning}
              scanError={scanError}
              canScan={!!source?.info}
              onScan={() => void scan()}
              options={sanitizeOptions}
              onOptions={setSanitizeOptions}
              locale={locale}
            />
          ) : null}

          <Section>
            <OutputPathField value={output} onChange={setOutput} disabled={operation.running} />
          </Section>
        </>
      }
      result={
        <ResultPanel
          idleContent={preview ? <MarkPreview request={preview} /> : undefined}
          sourcePath={source?.path}
          sourcePassword={source?.password ?? (tab === "decrypt" ? decryptPassword || undefined : undefined)}
          outputPassword={tab === "encrypt" ? userPassword || ownerPassword || undefined : undefined}
          status={operation.status}
          progress={operation.progress}
          error={operation.error}
          numeral={operation.result ? formatNumber("stamped" in operation.result ? operation.result.stamped : (removedTotal(operation.result) ?? operation.result.pageCount), locale) : undefined}
          caption={
            operation.result
              ? "stamped" in operation.result
                ? t("tools.security.stamp.stamped")
                : removedTotal(operation.result) === null
                  ? t("info.pages")
                  : "removed" in operation.result
                    ? t("tools.security.privacy.removed")
                    : t("tools.security.removeWatermark.removed")
              : undefined
          }
          outputs={operation.result ? [operation.result.output] : []}
          idleIcon={ShieldCheck}
          idleTitle={t("tools.security.idle.title")}
          idleDescription={t("tools.security.idle.description")}
          onCancel={operation.cancel}
          onRetry={run}
          overwritePrompt={operation.overwritePrompt}
          onConfirmOverwrite={operation.confirmOverwrite}
          onDismissOverwrite={operation.dismissOverwrite}
        >
          {operation.result && "solidInkPages" in operation.result && operation.result.solidInkPages ? (
            <p role="status" className="flex items-start gap-2 px-4 py-2.5 text-sm text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t("tools.security.removeWatermark.solidInkLeft", { count: operation.result.solidInkPages })}
            </p>
          ) : null}
          {operation.result && "generatedOwnerPassword" in operation.result && operation.result.generatedOwnerPassword ? (
            <GeneratedOwnerPassword value={operation.result.generatedOwnerPassword} />
          ) : null}
          {operation.result && "expiredRecipients" in operation.result && operation.result.expiredRecipients.length > 0 ? (
            <p role="status" className="flex items-start gap-2 px-4 py-2.5 text-sm text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              {t("tools.security.certificate.expiredRecipients", { names: operation.result.expiredRecipients.join(", "), count: operation.result.expiredRecipients.length })}
            </p>
          ) : null}
        </ResultPanel>
      }
    />
  );
}
