import { FileInput } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUiStore } from "@/shared/store/uiStore";
import { isXfaOnly } from "./formFillStore";
import { useFormFields } from "./useFormFields";

export function FormXfaNotice({ documentId }: { documentId: string }) {
  const { t } = useTranslation();
  const load = useFormFields(documentId);
  const immersive = useUiStore((state) => state.immersive);
  if (immersive || !isXfaOnly(load)) return null;
  return (
    <div role="status" className="pointer-events-none absolute inset-x-0 top-2 z-30 flex justify-center">
      <div className="flex items-center gap-2 rounded-md border bg-card/95 px-3 py-1.5 text-xs shadow-sm">
        <FileInput className="size-4 shrink-0 text-primary" aria-hidden />
        <span>{t("viewer.formFill.xfaOnly")}</span>
      </div>
    </div>
  );
}
