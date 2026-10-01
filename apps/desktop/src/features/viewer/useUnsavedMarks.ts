import { useEffect, useState } from "react";
import { useHistoryCapability } from "@embedpdf/plugin-history/react";
import { outsideRender } from "@/shared/lib/outsideRender";

export function useUnsavedMarks(documentId: string): boolean {
  const { provides: historyCapability } = useHistoryCapability();
  const [unsaved, setUnsaved] = useState(false);

  useEffect(() => {
    const scope = historyCapability?.forDocument(documentId);
    if (!scope) {
      setUnsaved(false);
      return;
    }
    const refresh = () => setUnsaved(scope.canUndo());
    refresh();
    const unsubscribe = scope.onHistoryChange(() => outsideRender(refresh));
    return () => {
      unsubscribe();
    };
  }, [historyCapability, documentId]);

  return unsaved;
}
