import { LockKeyholeOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Button } from "@/components/shared/Button";
import { sealedFileRoute } from "@/shared/lib/sealedRoute";
import type { RpcError } from "@/types";

export function SealedFileAction({ error, path, className }: { error: RpcError | null; path?: string; className?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const route = sealedFileRoute(error, path);
  if (!route) return null;
  return (
    <div className={className}>
      <Button size="sm" variant="primary" icon={<LockKeyholeOpen className="size-4" aria-hidden />} onClick={() => void navigate(route)}>
        {t("tools.security.decryptCertificate.openSealed")}
      </Button>
    </div>
  );
}
