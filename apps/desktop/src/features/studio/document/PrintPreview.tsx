import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";
import { DocumentPreview } from "./DocumentPreview";
import type { DocumentLayout } from "./useDocumentLayout";

export function PrintPreview({ open, layout, onClose, onExport }: { open: boolean; layout: DocumentLayout; onClose: () => void; onExport: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title={t("studio.doc.printPreview.title")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button
            variant="primary"
            icon={<Download className="size-4" aria-hidden />}
            onClick={() => {
              onClose();
              onExport();
            }}
          >
            {t("studio.toolbar.export")}
          </Button>
        </>
      }
    >
      <div className="h-[70vh] min-h-0" data-testid="document-print-preview">
        <DocumentPreview layout={layout} />
      </div>
    </Dialog>
  );
}
