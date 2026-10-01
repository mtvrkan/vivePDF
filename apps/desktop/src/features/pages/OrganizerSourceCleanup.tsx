import { useEffect, useRef } from "react";
import { useDocumentManagerCapability } from "@embedpdf/plugin-document-manager/react";
import { watchDocumentLifecycles } from "./sourceCleanup";

export function OrganizerSourceCleanup() {
  const { provides: docManager } = useDocumentManagerCapability();
  const managerRef = useRef(docManager);
  managerRef.current = docManager;

  useEffect(
    () =>
      watchDocumentLifecycles(() => {
        const manager = managerRef.current;
        if (!manager) return null;
        return {
          isDocumentOpen: (id) => manager.isDocumentOpen(id),
          closeDocument: (id) => manager.closeDocument(id).wait(() => undefined, () => undefined),
        };
      }),
    [],
  );

  return null;
}
