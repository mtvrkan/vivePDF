import { useEffect } from "react";
import { FileInput, ShieldAlert, ShieldCheck, ShieldX, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { IconButton } from "@/components/shared/IconButton";
import { cn } from "@/shared/lib/cn";
import { signaturesStatus, type SignaturesStatus } from "@/shared/lib/signatureVerdict";
import { useDocumentMessagesStore } from "@/shared/store/documentMessagesStore";
import { useDocumentStore } from "@/shared/store/documentStore";
import { checkSignatures, toggleFieldHighlight } from "./documentChecks";

const checkedInfos = new WeakSet<object>();

const STATUS_ICONS = { valid: ShieldCheck, attention: ShieldAlert, invalid: ShieldX } satisfies Record<SignaturesStatus, unknown>;
const STATUS_TONES: Record<SignaturesStatus, string> = { valid: "text-success", attention: "text-warning", invalid: "text-destructive" };

function MessageRow({ tone, children }: { tone?: SignaturesStatus; children: React.ReactNode }) {
  return (
    <div role="status" data-message-tone={tone} className="glass-flat flex h-9 shrink-0 items-center gap-2 border-b px-3 text-xs">
      {children}
    </div>
  );
}

export function DocumentMessageBar({ documentId, onOpenSignatures }: { documentId: string; onOpenSignatures: () => void }) {
  const { t } = useTranslation();
  const document = useDocumentStore((state) => state.documents[documentId] ?? null);
  const check = useDocumentMessagesStore((state) => state.signatures[documentId] ?? null);
  const highlight = useDocumentMessagesStore((state) => state.highlights[documentId] ?? null);
  const dismissed = useDocumentMessagesStore((state) => state.dismissed[documentId]);
  const dismiss = useDocumentMessagesStore((state) => state.dismiss);
  const info = document?.info ?? null;

  useEffect(() => {
    if (!document || !info || checkedInfos.has(info)) return;
    checkedInfos.add(info);
    void checkSignatures({ id: document.id, path: document.path, password: document.password });
  }, [document, info]);

  if (!document) return null;
  const source = { id: document.id, path: document.path, password: document.password };
  const showSignatures = check?.state === "checked" && !dismissed?.includes("signatures");
  const showForms = Boolean(info?.hasForms) && !dismissed?.includes("forms");
  if (!showSignatures && !showForms) return null;

  const status = check?.state === "checked" ? signaturesStatus(check.signatures) : null;
  const StatusIcon = status ? STATUS_ICONS[status] : null;

  return (
    <>
      {showSignatures && status && StatusIcon ? (
        <MessageRow tone={status}>
          <StatusIcon className={cn("size-4 shrink-0", STATUS_TONES[status])} aria-hidden />
          <span className="min-w-0 flex-1 truncate">{t(`viewer.messages.signatures.${status}`)}</span>
          <Button size="sm" variant="ghost" onClick={onOpenSignatures}>
            {t("viewer.messages.signatures.panel")}
          </Button>
          <IconButton icon={X} label={t("viewer.messages.dismiss")} onClick={() => dismiss(documentId, "signatures")} />
        </MessageRow>
      ) : null}
      {showForms ? (
        <MessageRow>
          <FileInput className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{t("viewer.messages.forms.present")}</span>
          {highlight?.state === "failed" ? <span className="text-destructive">{t("viewer.messages.forms.failed")}</span> : null}
          <Button size="sm" variant="ghost" aria-pressed={highlight !== null && highlight.state !== "failed"} loading={highlight?.state === "loading"} onClick={() => void toggleFieldHighlight(source)}>
            {t("viewer.messages.forms.highlight")}
          </Button>
          <IconButton icon={X} label={t("viewer.messages.dismiss")} onClick={() => dismiss(documentId, "forms")} />
        </MessageRow>
      ) : null}
    </>
  );
}
