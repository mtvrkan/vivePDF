import { useState } from "react";
import { FileDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { describeError } from "@/shared/lib/errorMessage";
import * as logger from "@/shared/lib/logger";
import { toastSavedFile } from "@/shared/lib/savedFileToast";
import { toRpcError } from "@/shared/rpc/client";
import { useToastStore } from "@/shared/store/toastStore";
import type { ShortcutGroup } from "./shortcutGroups";
import { saveShortcutsPdf } from "./shortcutsPdf";

export function SaveShortcutsPdfButton({ groups }: { groups: ShortcutGroup[] }) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);

  const saveAsPdf = async () => {
    setSaving(true);
    try {
      const output = await saveShortcutsPdf(groups, t);
      if (output) toastSavedFile(t, t("shortcutSheet.pdf.saved"), output);
    } catch (error) {
      logger.error("shortcuts", `saveAsPdf failed: ${String(error)}`);
      useToastStore.getState().push("error", describeError(t, toRpcError(error)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Button variant="secondary" loading={saving} icon={<FileDown className="size-4" aria-hidden />} onClick={() => void saveAsPdf()}>
      {t("shortcutSheet.pdf.save")}
    </Button>
  );
}
