import { useCallback, useEffect, useState } from "react";
import { Plus, ShieldCheck, Trash2, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/shared/Button";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { IconButton } from "@/components/shared/IconButton";
import { SkeletonCard } from "@/components/shared/SkeletonCard";
import { Checkbox, Section } from "@/components/tool/form";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { addTrustRoot, clearTrustRoots, listTrustRoots, previewTrustRoots, removeTrustRoot } from "@/shared/rpc/operations";
import { useToastStore } from "@/shared/store/toastStore";
import { useUiStore } from "@/shared/store/uiStore";
import type { RpcError, TrustListResult, TrustListSignature, TrustPreviewResult, TrustRoot, TrustSource } from "@/types";
import { sharedTrustFiles, shortFingerprint, trustSourceName } from "./signHelpers";

const TRUST_FILE_EXTENSIONS = ["cer", "crt", "pem", "der", "xml", "pdf", "acrobatsecuritysettings"];
const PREVIEW_SUBJECTS = 8;

type TrustState =
  | { status: "loading" }
  | { status: "error"; error: RpcError }
  | { status: "ready"; list: TrustListResult };

type PendingImport = { path: string; preview: TrustPreviewResult };

const CERTIFICATE_EXTENSIONS = [".cer", ".crt", ".pem", ".der"];

const isCertificateFile = (path: string) => CERTIFICATE_EXTENSIONS.some((extension) => path.toLowerCase().endsWith(extension));

const statusTone = (status: TrustListSignature["status"]) => (status === "verified" ? "text-success" : status === "pinMismatch" ? "font-medium text-destructive" : "text-warning");

const needsOverride = (preview: TrustPreviewResult) => preview.signature !== null && preview.signature.status !== "verified";

function PreviewSubjects({ roots }: { roots: TrustRoot[] }) {
  const { t } = useTranslation();
  const hidden = roots.length - PREVIEW_SUBJECTS;
  return (
    <ul className="list-disc space-y-0.5 ps-5 text-xs text-muted-foreground">
      {roots.slice(0, PREVIEW_SUBJECTS).map((root) => (
        <li key={`${root.id}-${root.fingerprint}`} className="break-words">{root.subject}</li>
      ))}
      {hidden > 0 ? <li>{t("tools.sign.verify.roots.preview.more", { count: hidden })}</li> : null}
    </ul>
  );
}

function SignatureDetails({ signature, formatDate }: { signature: TrustListSignature; formatDate: (value: string) => string }) {
  const { t } = useTranslation();
  const { signer } = signature;
  return (
    <div className="space-y-0.5 text-xs">
      <p className={statusTone(signature.status)}>{t(`tools.sign.verify.roots.preview.signature.status.${signature.status}`)}</p>
      {signer ? (
        <>
          <p className="break-words text-muted-foreground">{t("tools.sign.verify.roots.preview.signature.signer", { subject: signer.subject, issuer: signer.issuer })}</p>
          <p title={signer.fingerprint} className="truncate font-mono text-muted-foreground">SHA-256 {shortFingerprint(signer.fingerprint)}</p>
          <p className={signer.expired ? "text-warning" : "text-muted-foreground"}>
            {t(signer.expired ? "tools.sign.verify.roots.preview.signature.signerExpired" : "tools.sign.verify.roots.preview.signature.signerValid", { date: formatDate(signer.validUntil) })}
          </p>
        </>
      ) : null}
      {signature.signedAt ? <p className="text-muted-foreground">{t("tools.sign.verify.roots.preview.signature.signedAt", { date: formatDate(signature.signedAt) })}</p> : null}
      {signature.stale && signature.nextUpdate ? <p className="text-warning">{t("tools.sign.verify.roots.preview.signature.stale", { date: formatDate(signature.nextUpdate) })}</p> : null}
    </div>
  );
}

export function TrustRootsSection({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const pushToast = useToastStore((state) => state.push);
  const [state, setState] = useState<TrustState>({ status: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [acceptUnverified, setAcceptUnverified] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setState({ status: "loading" });
    try {
      setState({ status: "ready", list: await listTrustRoots() });
    } catch (error) {
      setState({ status: "error", error: toRpcError(error) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sourceLabel = (source: TrustSource) => trustSourceName(source) ?? t(`tools.sign.verify.roots.kinds.${source.kind}`);

  const commit = async (path: string, preview: TrustPreviewResult, accepted: boolean) => {
    const result = await addTrustRoot({ path, expectedDigest: preview.digest, acceptUnverified: accepted });
    const changed = result.added.length + result.withdrawn > 0;
    const summary = { added: result.added.length, known: result.known, withdrawn: result.withdrawn };
    pushToast(changed ? "success" : "info", t(result.withdrawn > 0 ? "tools.sign.verify.roots.withdrawnSummary" : "tools.sign.verify.roots.addedSummary", summary));
    setPending(null);
    await load(true);
    if (changed) onChanged();
  };

  const add = async () => {
    const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: t("tools.sign.verify.roots.filter"), extensions: TRUST_FILE_EXTENSIONS }] });
    if (typeof selected !== "string") return;
    setBusy("add");
    try {
      const preview = await previewTrustRoots({ path: selected });
      if (preview.added.length === 0 && preview.withdrawn.length === 0 && preview.pinned === 0) {
        pushToast("info", t("tools.sign.verify.roots.addedSummary", { added: 0, known: preview.known }));
      } else if (preview.source === null && preview.signature === null && isCertificateFile(selected) && preview.added.length === 1 && preview.withdrawn.length === 0) {
        await commit(selected, preview, false);
      } else {
        setConfirmingClear(false);
        setAcceptUnverified(false);
        setPending({ path: selected, preview });
      }
    } catch (error) {
      pushToast("error", describeError(t, toRpcError(error)));
    } finally {
      setBusy(null);
    }
  };

  const confirmImport = async (path: string, preview: TrustPreviewResult) => {
    setBusy("import");
    try {
      await commit(path, preview, acceptUnverified);
    } catch (error) {
      pushToast("error", describeError(t, toRpcError(error)));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    setBusy(id);
    try {
      await removeTrustRoot({ id });
      await load(true);
      onChanged();
    } catch (error) {
      pushToast("error", describeError(t, toRpcError(error)));
      await load(true);
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    setBusy("clear");
    try {
      const result = await clearTrustRoots();
      setConfirmingClear(false);
      pushToast("success", t("tools.sign.verify.roots.cleared", { count: result.removed }));
      await load(true);
      onChanged();
    } catch (error) {
      pushToast("error", describeError(t, toRpcError(error)));
      await load(true);
    } finally {
      setBusy(null);
    }
  };

  const formatDate = (value: string) => new Date(value).toLocaleDateString(locale);
  const sharedFiles = state.status === "ready" ? sharedTrustFiles(state.list.roots) : new Set<string>();
  const addButton = (
    <Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => void add()} loading={busy === "add"} disabled={busy !== null || pending !== null}>
      {t("tools.sign.verify.roots.add")}
    </Button>
  );

  return (
    <Section title={t("tools.sign.verify.roots.title")}>
      <p className="text-sm text-muted-foreground">{t("tools.sign.verify.roots.hint")}</p>
      {state.status === "loading" ? <SkeletonCard lines={2} /> : null}
      {state.status === "error" ? <ErrorState title={t("tools.sign.verify.roots.loadFailed")} message={describeError(t, state.error)} onRetry={() => void load()} /> : null}
      {state.status === "ready" && state.list.roots.length === 0 && state.list.unreadable.length === 0 ? (
        <EmptyState icon={ShieldCheck} title={t("tools.sign.verify.roots.empty.title")} description={t("tools.sign.verify.roots.empty.description")} action={addButton} />
      ) : null}
      {state.status === "ready" && (state.list.roots.length > 0 || state.list.unreadable.length > 0) ? (
        <>
          <ul className="max-h-96 divide-y overflow-y-auto rounded-md border">
            {state.list.roots.map((root) => {
              const shared = sharedFiles.has(root.id);
              return (
                <li key={`${root.id}-${root.fingerprint}`} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                  <ShieldCheck className={root.expired ? "mt-0.5 size-4 shrink-0 text-warning" : "mt-0.5 size-4 shrink-0 text-success"} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p title={root.subject} className="truncate font-medium">{root.subject}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t(root.selfSigned ? "tools.sign.verify.roots.selfIssued" : "tools.sign.verify.roots.issuedBy", { issuer: root.issuer })}
                      {" · "}
                      <span className={root.expired ? "text-warning" : undefined}>
                        {t(root.expired ? "tools.sign.verify.roots.expired" : "tools.sign.verify.roots.validUntil", { date: formatDate(root.validUntil) })}
                      </span>
                      {root.authority ? ` · ${t("tools.sign.verify.roots.authority")}` : ""}
                    </p>
                    <p title={root.fingerprint} className="mt-0.5 truncate font-mono text-xs text-muted-foreground">SHA-256 {shortFingerprint(root.fingerprint)}</p>
                    {root.lists.length > 0 ? <p className="mt-0.5 text-xs text-muted-foreground">{t("tools.sign.verify.roots.fromList", { lists: root.lists.map(sourceLabel).join(", ") })}</p> : null}
                    {shared ? <p className="mt-0.5 text-xs text-muted-foreground">{t("tools.sign.verify.roots.sharedFile")}</p> : null}
                  </div>
                  <IconButton icon={Trash2} label={t("tools.sign.verify.roots.remove", { name: root.subject })} busy={busy === root.id} disabled={busy !== null} onClick={() => void remove(root.id)} />
                </li>
              );
            })}
            {state.list.unreadable.map((name) => (
              <li key={name} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                <p className="min-w-0 flex-1 break-all">{t("tools.sign.verify.roots.unreadable", { name })}</p>
                <IconButton icon={Trash2} label={t("tools.sign.verify.roots.remove", { name })} busy={busy === name} disabled={busy !== null} onClick={() => void remove(name)} />
              </li>
            ))}
          </ul>
          {pending ? null : confirmingClear ? (
            <div role="group" aria-label={t("tools.sign.verify.roots.clear")} className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 px-3 py-2">
              <p className="min-w-0 flex-1 text-sm">{t("tools.sign.verify.roots.clearConfirm", { count: state.list.roots.length + state.list.unreadable.length })}</p>
              <Button size="sm" variant="destructive" onClick={() => void clear()} loading={busy === "clear"} disabled={busy !== null}>
                {t("tools.sign.verify.roots.clearConfirmAction")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmingClear(false)} disabled={busy !== null}>
                {t("common.cancel")}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {addButton}
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => setConfirmingClear(true)} disabled={busy !== null}>
                {t("tools.sign.verify.roots.clear")}
              </Button>
            </div>
          )}
        </>
      ) : null}
      {pending ? (
        <div role="group" aria-label={t("tools.sign.verify.roots.preview.title")} className="space-y-2 rounded-md border px-3 py-2 text-sm">
          <p className="font-medium">{pending.preview.source ? t("tools.sign.verify.roots.preview.list", { name: pending.preview.source.kind === "euListOfLists" ? t("tools.sign.verify.roots.kinds.euListOfLists") : sourceLabel(pending.preview.source) }) : t("tools.sign.verify.roots.preview.title")}</p>
          {pending.preview.signature ? <SignatureDetails signature={pending.preview.signature} formatDate={formatDate} /> : null}
          {pending.preview.source?.kind === "euListOfLists" ? (
            <p>{t("tools.sign.verify.roots.preview.pins", { count: pending.preview.pinned })}</p>
          ) : (
            <p>{t("tools.sign.verify.roots.preview.summary", { added: pending.preview.added.length, known: pending.preview.known })}</p>
          )}
          {pending.preview.added.length > 0 ? <PreviewSubjects roots={pending.preview.added} /> : null}
          {pending.preview.withdrawn.length > 0 ? (
            <>
              <p className="text-warning">{t("tools.sign.verify.roots.preview.withdrawn", { count: pending.preview.withdrawn.length })}</p>
              <PreviewSubjects roots={pending.preview.withdrawn} />
            </>
          ) : null}
          {needsOverride(pending.preview) ? (
            <Checkbox label={t("tools.sign.verify.roots.preview.acceptUnverified")} checked={acceptUnverified} onChange={setAcceptUnverified} disabled={busy !== null} />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void confirmImport(pending.path, pending.preview)} loading={busy === "import"} disabled={busy !== null || (needsOverride(pending.preview) && !acceptUnverified)}>
              {t(pending.preview.source?.kind === "euListOfLists" ? "tools.sign.verify.roots.preview.confirmSigners" : "tools.sign.verify.roots.preview.confirm")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPending(null)} disabled={busy !== null}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : null}
    </Section>
  );
}
