import { Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/shared/Button";
import { canOfferRepair, openInRepair, REPAIR_PATHNAME } from "@/shared/lib/repairRoute";
import type { RpcError } from "@/types";

export function RepairFileAction({ error, path, className }: { error: RpcError | null; path?: string; className?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const onRepairTab = pathname === REPAIR_PATHNAME && searchParams.get("tab") === "repair";
  if (!canOfferRepair(error, path, onRepairTab)) return null;
  const action = (
    <Button size="sm" icon={<Wrench className="size-4" aria-hidden />} onClick={() => openInRepair(path, navigate)}>
      {t("tools.edit.repair.repairFile")}
    </Button>
  );
  return className ? <div className={className}>{action}</div> : action;
}
