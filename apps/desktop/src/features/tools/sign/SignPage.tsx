import { useEffect, useState } from "react";
import { BadgeCheck, FileKey2, FolderOpen, PenTool, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/shared/Button";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { PasswordBreachWarning } from "@/components/shared/PasswordBreachNote";
import { Checkbox, Field, Section, SelectInput, SwitchField, TextInput } from "@/components/tool/form";
import { PositionGrid } from "@/components/tool/PositionGrid";
import { OutputPathField } from "@/components/tool/OutputPathField";
import { ResultPanel } from "@/components/tool/ResultPanel";
import { SourcePicker } from "@/components/tool/SourcePicker";
import { ToolLayout } from "@/components/tool/ToolLayout";
import { useOperation } from "@/shared/hooks/useOperation";
import { useSourceDocument } from "@/shared/hooks/useSourceDocument";
import { useTabParam } from "@/shared/hooks/useTabParam";
import { cn } from "@/shared/lib/cn";
import { basenameOf, dirnameOf, joinPath, suggestOutputPath } from "@/shared/lib/paths";
import { toRpcError, type RpcCallOptions } from "@/shared/rpc/client";
import { createCertificate, exportCertificate, listSignatureFields, signPdf, verifySignatures } from "@/shared/rpc/operations";
import { useSignatureStore } from "@/shared/store/signatureStore";
import { useUiStore } from "@/shared/store/uiStore";
import type { CertificateUsage, CertifyPermission, CreateCertificateResult, ExportCertificateResult, RpcError, SignatureFieldsResult, SignResult, TextPosition, VerifyResult } from "@/types";
import { describeError } from "@/shared/lib/errorMessage";
import { certificateReason, insecureTimestamp, MIN_KEY_PASSWORD, nameTooLong, stampTextForInput, stampTextFromInput } from "./signHelpers";
import { TrustRootsSection } from "./TrustRootsSection";
import { SignatureItem } from "@/components/document/SignatureItem";

type Tab = "sign" | "verify" | "certificate" | "export";
const TABS: Tab[] = ["sign", "verify", "certificate", "export"];
const CERT_KEY = "vivepdf.certificatePath";
const USAGES: CertificateUsage[] = ["signing", "encryption", "both"];
const PERMISSIONS: CertifyPermission[] = ["none", "forms", "annotations"];
const NEW_FIELD = "";
const NO_IMAGE = "";
const IMAGE_FILE = "__file";

type SignRun =
  | { kind: "sign"; params: Parameters<typeof signPdf>[0] }
  | { kind: "certificate"; params: Parameters<typeof createCertificate>[0] }
  | { kind: "export"; params: Parameters<typeof exportCertificate>[0] };
type SignRunWithOverwrite = SignRun & { overwrite?: boolean };
type SignOutcome = { output: string; caption: string; numeral: string };

async function runSign(run: SignRunWithOverwrite, options: RpcCallOptions): Promise<SignOutcome> {
  const overwrite = run.overwrite ?? run.params.overwrite;
  if (run.kind === "sign") {
    const result: SignResult = await signPdf({ ...run.params, overwrite }, options);
    return { output: result.output, caption: result.signer, numeral: "✓" };
  }
  if (run.kind === "export") {
    const exported: ExportCertificateResult = await exportCertificate({ ...run.params, overwrite }, options);
    return { output: exported.output, caption: exported.subject, numeral: "CER" };
  }
  const result: CreateCertificateResult = await createCertificate({ ...run.params, overwrite, replaceKey: overwrite }, options);
  return { output: result.output, caption: result.subject, numeral: "P12" };
}

function stampBox(position: TextPosition, width: number, height: number): number[] {
  const boxWidth = 200;
  const boxHeight = 60;
  const margin = 36;
  const x0 = position.endsWith("left") ? margin : position.endsWith("right") ? width - margin - boxWidth : (width - boxWidth) / 2;
  const y0 = position.startsWith("top") ? margin : position.startsWith("bottom") ? height - margin - boxHeight : (height - boxHeight) / 2;
  return [x0, y0, x0 + boxWidth, y0 + boxHeight];
}

function readStoredCertificate(): string {
  try {
    return localStorage.getItem(CERT_KEY) ?? "";
  } catch {
    return "";
  }
}

export function SignPage() {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const [tab, setTab] = useTabParam<Tab>(TABS, "sign");
  const sourceState = useSourceDocument();
  const operation = useOperation(runSign);
  const [output, setOutput] = useState("");
  const [certificatePath, setCertificatePath] = useState(readStoredCertificate);
  const [certificatePassword, setCertificatePassword] = useState("");
  const [onlineCheck, setOnlineCheck] = useState(false);
  const [page, setPage] = useState(1);
  const [visible, setVisible] = useState(true);
  const [position, setPosition] = useState<TextPosition>("bottom-right");
  const [reason, setReason] = useState("");
  const [location, setLocation] = useState("");
  const [contact, setContact] = useState("");
  const [stampText, setStampText] = useState("{signer}\n{date}");
  const [certify, setCertify] = useState(false);
  const [certifyPermission, setCertifyPermission] = useState<CertifyPermission>("forms");
  const [lock, setLock] = useState(false);
  const [existingField, setExistingField] = useState(NEW_FIELD);
  const [imageChoice, setImageChoice] = useState(NO_IMAGE);
  const [imagePath, setImagePath] = useState("");
  const [signatureFields, setSignatureFields] = useState<SignatureFieldsResult | null>(null);
  const savedSignatures = useSignatureStore((state) => state.items);
  const [timestampUrl, setTimestampUrl] = useState("");
  const [verification, setVerification] = useState<{ status: "idle" | "loading" | "success" | "error"; result: VerifyResult | null; error: RpcError | null }>({ status: "idle", result: null, error: null });
  const [commonName, setCommonName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [country, setCountry] = useState("TR");
  const [validDays, setValidDays] = useState(1095);
  const [keyType, setKeyType] = useState<"rsa" | "ec">("rsa");
  const [usage, setUsage] = useState<CertificateUsage>("signing");
  const [certPassword, setCertPassword] = useState("");
  const [certOutput, setCertOutput] = useState("");
  const [exportSource, setExportSource] = useState("");
  const [exportPassword, setExportPassword] = useState("");
  const [exportOutput, setExportOutput] = useState("");

  const source = sourceState.source;

  useEffect(() => {
    if (source) setOutput(suggestOutputPath(source.path, t("tools.sign.suffix")));
  }, [source, t]);

  useEffect(() => {
    setVerification({ status: "idle", result: null, error: null });
    setExistingField(NEW_FIELD);
    setSignatureFields(null);
    if (!source?.info) return;
    let cancelled = false;
    void listSignatureFields({ path: source.path, password: source.password ?? undefined })
      .then((result) => {
        if (!cancelled) setSignatureFields(result);
      })
      .catch(() => {
        if (!cancelled) setSignatureFields(null);
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  useEffect(() => {
    try {
      localStorage.setItem(CERT_KEY, certificatePath);
    } catch {
      void 0;
    }
  }, [certificatePath]);

  const selectTab = (next: Tab) => {
    setTab(next);
    operation.reset();
  };

  const pickCertificate = async () => {
    const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: "PKCS#12", extensions: ["p12", "pfx"] }] });
    if (typeof selected === "string") setCertificatePath(selected);
  };

  const pickImage = async () => {
    const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: "PNG / JPEG", extensions: ["png", "jpg", "jpeg"] }] });
    if (typeof selected !== "string") return;
    setImagePath(selected);
    setImageChoice(IMAGE_FILE);
  };

  const pickExportSource = async () => {
    const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: "PKCS#12", extensions: ["p12", "pfx"] }] });
    if (typeof selected !== "string") return;
    setExportSource(selected);
    if (!exportOutput) setExportOutput(joinPath(dirnameOf(selected), `${basenameOf(selected).replace(/\.(p12|pfx)$/i, "")}.cer`));
  };

  const pickExportOutput = async () => {
    const selected = await saveDialog({ defaultPath: exportOutput || "sertifika.cer", filters: [{ name: "X.509", extensions: ["cer"] }] });
    if (selected) setExportOutput(selected.toLowerCase().endsWith(".cer") ? selected : `${selected}.cer`);
  };

  const pickCertificateOutput = async () => {
    const selected = await saveDialog({ defaultPath: certOutput || `${commonName || "sertifika"}.p12`, filters: [{ name: "PKCS#12", extensions: ["p12"] }] });
    if (selected) setCertOutput(selected.toLowerCase().endsWith(".p12") ? selected : `${selected}.p12`);
  };

  const verify = async () => {
    if (!source) return;
    setVerification({ status: "loading", result: null, error: null });
    try {
      const result = await verifySignatures({ path: source.path, password: source.password ?? undefined, online: onlineCheck });
      setVerification({ status: "success", result, error: null });
    } catch (error) {
      setVerification({ status: "error", result: null, error: toRpcError(error) });
    }
  };

  const pageSize = source?.info?.pageSizes[Math.max(0, Math.min(page - 1, (source.info.pageSizes.length || 1) - 1))];
  const emptyFields = signatureFields?.fields.filter((field) => !field.signed) ?? [];
  const hasSignatures = signatureFields?.fields.some((field) => field.signed) ?? false;
  const certification = signatureFields?.certification ?? null;
  const signBlocked = !!signatureFields && (signatureFields.locked || certification === "none" || (certification !== null && existingField === NEW_FIELD));
  const pageValid = page >= 1 && page <= (source?.info?.pageCount ?? 1);
  const savedImage = savedSignatures.find((item) => item.id === imageChoice);
  const signReady = !!source?.info && !!output && !!certificatePath && pageValid && !signBlocked;
  const commonNameTooLong = nameTooLong(commonName);
  const organizationTooLong = nameTooLong(organization);
  const certPasswordShort = certPassword.length > 0 && certPassword.length < MIN_KEY_PASSWORD;
  const certReady = commonName.trim().length > 0 && !commonNameTooLong && !organizationTooLong && certPassword.length >= MIN_KEY_PASSWORD && !!certOutput;
  const exportReady = !!exportSource && !!exportOutput;

  const run = () => {
    if (tab === "sign" && source && signReady) {
      void operation.run({
        kind: "sign",
        params: {
          path: source.path,
          password: source.password ?? undefined,
          output,
          certificatePath,
          certificatePassword,
          page,
          box: visible && pageSize && existingField === NEW_FIELD ? stampBox(position, pageSize.width, pageSize.height) : undefined,
          visible,
          reason,
          location,
          contact,
          stampText,
          certify: certify && !hasSignatures,
          certifyPermission,
          lock: lock && !certify && existingField === NEW_FIELD,
          existingField: existingField || undefined,
          imagePath: visible && imageChoice === IMAGE_FILE && imagePath ? imagePath : undefined,
          imageBase64: visible && savedImage ? savedImage.dataUrl : undefined,
          timestampUrl: timestampUrl.trim() || undefined,
        },
      });
    } else if (tab === "certificate" && certReady) {
      void operation.run({ kind: "certificate", params: { output: certOutput, password: certPassword, commonName, email, organization, country, validDays, keyType, usage } });
    } else if (tab === "export" && exportReady) {
      void operation.run({ kind: "export", params: { path: exportSource, password: exportPassword, output: exportOutput } });
    } else if (tab === "verify") {
      void verify();
    }
  };

  const result = operation.result;
  const certificateProblem = certificateReason(operation.error?.data?.reason);
  const certificateError = certificateProblem !== null;
  const certificateMessage = certificateProblem === null ? "" : t(certificateProblem === "certificate" ? "tools.sign.sign.certificateError" : `errors.reasons.${certificateProblem}`);

  const resetOperation = operation.reset;

  useEffect(() => {
    resetOperation();
    setCertificatePassword("");
    setCertPassword("");
    setExportPassword("");
  }, [tab, resetOperation]);

  useEffect(() => {
    if (!result) return;
    setCertificatePassword("");
    setCertPassword("");
    setExportPassword("");
  }, [result]);

  return (
    <ToolLayout
      title={t(`tools.sign.${tab}.title`)}
      icon={PenTool}
      actions={
        <Button variant="primary" onClick={run} loading={operation.running || verification.status === "loading"} disabled={tab === "sign" ? !signReady : tab === "certificate" ? !certReady : tab === "export" ? !exportReady : !source?.info}>
          {t(`tools.sign.${tab}.run`)}
        </Button>
      }
      form={
        <>
          {tab === "sign" || tab === "verify" ? (
            <SourcePicker {...sourceState} onPick={() => void sourceState.pick()} onPassword={(password) => void sourceState.submitPassword(password)} disabled={operation.running} />
          ) : null}

          {tab === "sign" ? (
            <>
              <Section title={t("tools.sign.sign.certificate")}>
                <Field label={t("tools.sign.sign.certificateFile")} hint={t("tools.sign.sign.certificateHint")}>
                  <div className="flex gap-2">
                    <TextInput value={certificatePath ? basenameOf(certificatePath) : ""} readOnly className="font-mono text-sm" aria-invalid={certificateError || undefined} />
                    <Button icon={<FolderOpen className="size-4" aria-hidden />} onClick={() => void pickCertificate()}>{t("tools.browse")}</Button>
                  </div>
                </Field>
                <Field label={t("tools.sign.sign.certificatePassword")}>
                  <TextInput type="password" value={certificatePassword} onChange={(event) => setCertificatePassword(event.target.value)} autoComplete="off" className="max-w-xs" />
                </Field>
                {certificateError ? <p role="alert" className="text-sm text-destructive">{certificateMessage}</p> : null}
                <button type="button" onClick={() => selectTab("certificate")} className="min-h-6 text-sm text-primary underline-offset-2 hover:underline">
                  {t("tools.sign.sign.noCertificate")}
                </button>
              </Section>
              <Section title={t("tools.sign.sign.appearance")}>
                {signatureFields?.locked ? <p className="text-sm text-destructive">{t("tools.sign.sign.lockedNote")}</p> : null}
                {certification === "none" ? <p className="text-sm text-destructive">{t("tools.sign.sign.certifiedNoChangesNote")}</p> : null}
                {certification !== null && certification !== "none" ? (
                  <p className={cn("text-sm", existingField === NEW_FIELD ? "text-destructive" : "text-muted-foreground")}>{t(emptyFields.length > 0 ? "tools.sign.sign.certifiedNote" : "tools.sign.sign.certifiedNoFieldNote")}</p>
                ) : null}
                {emptyFields.length > 0 ? (
                  <Field label={t("tools.sign.sign.field")} hint={t("tools.sign.sign.fieldHint")}>
                    <SelectInput value={existingField} onChange={(event) => setExistingField(event.target.value)} className="max-w-sm">
                      <option value={NEW_FIELD}>{t("tools.sign.sign.newField")}</option>
                      {emptyFields.map((field) => (
                        <option key={field.name} value={field.name}>{t("tools.sign.sign.existingField", { name: field.name, page: field.page })}</option>
                      ))}
                    </SelectInput>
                  </Field>
                ) : null}
                <Checkbox label={t("tools.sign.sign.visible")} checked={visible} onChange={setVisible} />
                <div className="grid grid-cols-3 gap-3">
                  <Field label={t("tools.sign.sign.page")} note={pageValid ? undefined : <span className="text-destructive">{t("tools.sign.sign.pageOutside", { count: source?.info?.pageCount ?? 1 })}</span>}>
                    <TextInput type="number" min={1} max={source?.info?.pageCount ?? 1} value={page} onChange={(event) => setPage(Math.max(1, Math.floor(Number(event.target.value) || 1)))} className="font-mono" disabled={!visible || existingField !== NEW_FIELD} aria-invalid={pageValid ? undefined : true} />
                  </Field>
                  <PositionGrid value={position} onChange={(value) => setPosition(value as TextPosition)} label={t("tools.position")} disabled={!visible || existingField !== NEW_FIELD} />
                  <Field label={t("tools.sign.sign.stampText")} hint={t("tools.sign.sign.stampHint")}>
                    <TextInput value={stampTextForInput(stampText)} onChange={(event) => setStampText(stampTextFromInput(event.target.value))} disabled={!visible} className="font-mono text-sm" />
                  </Field>
                </div>
                <Field label={t("tools.sign.sign.image")} hint={t("tools.sign.sign.imageHint")}>
                  <div className="flex gap-2">
                    <SelectInput value={imageChoice} onChange={(event) => setImageChoice(event.target.value)} disabled={!visible} className="max-w-sm">
                      <option value={NO_IMAGE}>{t("tools.sign.sign.noImage")}</option>
                      {savedSignatures.map((item) => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                      {imagePath ? <option value={IMAGE_FILE}>{basenameOf(imagePath)}</option> : null}
                    </SelectInput>
                    <Button icon={<FolderOpen className="size-4" aria-hidden />} onClick={() => void pickImage()} disabled={!visible}>{t("tools.browse")}</Button>
                  </div>
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label={t("tools.sign.sign.reason")}><TextInput value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
                  <Field label={t("tools.sign.sign.location")}><TextInput value={location} onChange={(event) => setLocation(event.target.value)} /></Field>
                  <Field label={t("tools.sign.sign.contact")}><TextInput value={contact} onChange={(event) => setContact(event.target.value)} /></Field>
                </div>
                <Field
                  label={t("tools.sign.sign.timestamp")}
                  hint={t("tools.sign.sign.timestampHint")}
                  note={insecureTimestamp(timestampUrl) ? (
                    <span className="flex items-start gap-1.5 text-foreground/80">
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                      {t("tools.sign.sign.timestampInsecure")}
                    </span>
                  ) : null}
                >
                  <TextInput value={timestampUrl} onChange={(event) => setTimestampUrl(event.target.value)} placeholder="https://freetsa.org/tsr" className="font-mono text-sm" />
                </Field>
                <Checkbox label={t("tools.sign.sign.certify")} hint={hasSignatures ? t("tools.sign.sign.certifyFirstOnly") : undefined} checked={certify && !hasSignatures} onChange={setCertify} disabled={hasSignatures} />
                {certify && !hasSignatures ? (
                  <Field label={t("tools.sign.sign.permission")}>
                    <SelectInput value={certifyPermission} onChange={(event) => setCertifyPermission(event.target.value as CertifyPermission)} className="max-w-sm">
                      {PERMISSIONS.map((value) => (
                        <option key={value} value={value}>{t(`tools.sign.sign.permissions.${value}`)}</option>
                      ))}
                    </SelectInput>
                  </Field>
                ) : null}
                <Checkbox label={t("tools.sign.sign.lock")} hint={t("tools.sign.sign.lockHint")} checked={lock && !certify && existingField === NEW_FIELD} onChange={setLock} disabled={certify || existingField !== NEW_FIELD} />
              </Section>
              <Section>
                <OutputPathField value={output} onChange={setOutput} disabled={operation.running} />
              </Section>
            </>
          ) : null}

          {tab === "verify" ? (
            <>
              <Section title={t("tools.sign.verify.title")}>
                <p className="text-sm text-muted-foreground">{t("tools.sign.verify.hint")}</p>
                <SwitchField label={t("tools.sign.verify.online")} hint={t("tools.sign.verify.onlineHint")} checked={onlineCheck} onChange={setOnlineCheck} />
              </Section>
              <TrustRootsSection
                onChanged={() => {
                  if (verification.status === "success") void verify();
                }}
              />
            </>
          ) : null}

          {tab === "certificate" ? (
            <>
              <Section title={t("tools.sign.certificate.identity")}>
                <p className="text-sm text-muted-foreground">{t("tools.sign.certificate.hint")}</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("tools.sign.certificate.commonName")} note={commonNameTooLong ? <span className="text-destructive">{t("errors.reasons.nameTooLong")}</span> : undefined}><TextInput value={commonName} onChange={(event) => setCommonName(event.target.value)} aria-invalid={operation.error?.data?.reason === "commonName" || commonNameTooLong || undefined} /></Field>
                  <Field label={t("tools.sign.certificate.email")} note={operation.error?.data?.reason === "email" ? <span className="text-destructive">{t("errors.reasons.email")}</span> : undefined}>
                    <TextInput type="email" value={email} onChange={(event) => setEmail(event.target.value)} aria-invalid={operation.error?.data?.reason === "email" || undefined} />
                  </Field>
                  <Field label={t("tools.sign.certificate.organization")} note={organizationTooLong ? <span className="text-destructive">{t("errors.reasons.nameTooLong")}</span> : undefined}><TextInput value={organization} onChange={(event) => setOrganization(event.target.value)} aria-invalid={organizationTooLong || undefined} /></Field>
                  <Field label={t("tools.sign.certificate.country")}><TextInput value={country} maxLength={2} onChange={(event) => setCountry(event.target.value.toUpperCase())} className="w-20 font-mono uppercase" /></Field>
                </div>
                <Field label={t("tools.sign.certificate.usage")} hint={t("tools.sign.certificate.usageHint")}>
                  <SelectInput
                    value={usage}
                    onChange={(event) => {
                      const next = event.target.value as CertificateUsage;
                      setUsage(next);
                      if (next !== "signing") setKeyType("rsa");
                    }}
                    className="max-w-sm"
                  >
                    {USAGES.map((value) => (
                      <option key={value} value={value}>{t(`tools.sign.certificate.usages.${value}`)}</option>
                    ))}
                  </SelectInput>
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label={t("tools.sign.certificate.validDays")}>
                    <SelectInput value={validDays} onChange={(event) => setValidDays(Number(event.target.value))}>
                      {[365, 730, 1095, 1825, 3650].map((days) => (
                        <option key={days} value={days}>{Math.round(days / 365)} {t("tools.sign.certificate.years")}</option>
                      ))}
                    </SelectInput>
                  </Field>
                  <Field label={t("tools.sign.certificate.keyType")} hint={usage === "signing" ? undefined : t("tools.sign.certificate.rsaOnly")}>
                    <SelectInput value={keyType} onChange={(event) => setKeyType(event.target.value as "rsa" | "ec")}>
                      <option value="rsa">RSA 3072</option>
                      <option value="ec" disabled={usage !== "signing"}>ECDSA P-256</option>
                    </SelectInput>
                  </Field>
                  <Field label={t("tools.sign.certificate.password")} hint={t("tools.sign.certificate.passwordHint")} note={certPasswordShort ? <span className="text-destructive">{t("errors.reasons.passwordTooShort")}</span> : certPassword ? <PasswordBreachWarning password={certPassword} /> : null}>
                    <TextInput type="password" value={certPassword} onChange={(event) => setCertPassword(event.target.value)} autoComplete="new-password" aria-invalid={certPasswordShort || undefined} />
                  </Field>
                </div>
              </Section>
              <Section>
                <Field label={t("tools.sign.certificate.output")}>
                  <div className="flex gap-2">
                    <TextInput value={certOutput ? basenameOf(certOutput) : ""} readOnly className="font-mono text-sm" />
                    <Button icon={<FolderOpen className="size-4" aria-hidden />} onClick={() => void pickCertificateOutput()}>{t("tools.browse")}</Button>
                  </div>
                  {certOutput ? <span className="mt-1 block text-xs text-muted-foreground">{joinPath(dirnameOf(certOutput), "")}</span> : null}
                </Field>
              </Section>
            </>
          ) : null}

          {tab === "export" ? (
            <Section title={t("tools.sign.export.title")}>
              <p className="text-sm text-muted-foreground">{t("tools.sign.export.hint")}</p>
              <Field label={t("tools.sign.export.source")}>
                <div className="flex gap-2">
                  <TextInput value={exportSource ? basenameOf(exportSource) : ""} readOnly className="font-mono text-sm" aria-invalid={certificateError || undefined} />
                  <Button icon={<FolderOpen className="size-4" aria-hidden />} onClick={() => void pickExportSource()}>{t("tools.browse")}</Button>
                </div>
              </Field>
              <Field label={t("tools.sign.export.password")} hint={t("tools.sign.export.passwordHint")}>
                <TextInput type="password" value={exportPassword} onChange={(event) => setExportPassword(event.target.value)} autoComplete="off" className="max-w-xs" />
              </Field>
              {certificateError ? <p role="alert" className="text-sm text-destructive">{certificateMessage}</p> : null}
              <Field label={t("tools.sign.export.output")}>
                <div className="flex gap-2">
                  <TextInput value={exportOutput ? basenameOf(exportOutput) : ""} readOnly className="font-mono text-sm" />
                  <Button icon={<FolderOpen className="size-4" aria-hidden />} onClick={() => void pickExportOutput()}>{t("tools.browse")}</Button>
                </div>
                {exportOutput ? <span className="mt-1 block text-xs text-muted-foreground">{joinPath(dirnameOf(exportOutput), "")}</span> : null}
              </Field>
            </Section>
          ) : null}
        </>
      }
      result={
        tab === "verify" ? (
          <aside aria-label={t("tools.resultPanel")} className="flex min-h-0 flex-col overflow-auto bg-card">
            {verification.status === "idle" ? <EmptyState icon={BadgeCheck} title={t("tools.sign.verify.idle.title")} description={t("tools.sign.verify.idle.description")} /> : null}
            {verification.status === "loading" ? <p className="p-6 text-sm text-muted-foreground">{t("common.loading")}</p> : null}
            {verification.status === "error" && verification.error ? (
              <ErrorState title={t("tools.failed")} message={describeError(t, verification.error)} onRetry={() => void verify()} />
            ) : null}
            {verification.status === "success" && verification.result ? (
              verification.result.signatures.length === 0 ? (
                <EmptyState icon={FileKey2} title={t("tools.sign.verify.none.title")} description={t("tools.sign.verify.none.description")} />
              ) : (
                <div>
                  <header className="border-b px-4 pb-3 pt-4">
                    <p className="font-mono text-display font-medium tabular-nums">{verification.result.signatures.length}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{t("tools.sign.verify.count")}</p>
                  </header>
                  <ul>
                    {verification.result.signatures.map((signature) => (
                      <SignatureItem key={signature.fieldName} signature={signature} locale={locale} />
                    ))}
                  </ul>
                </div>
              )
            ) : null}
          </aside>
        ) : (
          <ResultPanel
            status={operation.status}
            progress={operation.progress}
            error={operation.error}
            numeral={result?.numeral}
            caption={result?.caption}
            outputs={result ? [result.output] : []}
            sourcePassword={source?.password ?? undefined}
            idleIcon={tab === "sign" ? PenTool : tab === "export" ? BadgeCheck : FileKey2}
            idleTitle={t(`tools.sign.${tab}.idle.title`)}
            idleDescription={t(`tools.sign.${tab}.idle.description`)}
            onCancel={operation.cancel}
            onRetry={run}
            overwritePrompt={operation.overwritePrompt}
            overwriteWarning={
              tab === "certificate" ? (
                <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground/80">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  {t("tools.sign.certificate.replaceKeyWarning")}
                </p>
              ) : undefined
            }
            onConfirmOverwrite={operation.confirmOverwrite}
            onDismissOverwrite={operation.dismissOverwrite}
          />
        )
      }
    />
  );
}
