import { useViewerOverlayStore } from "@/shared/store/viewerOverlayStore";
import { DRAWING_SPECS } from "./drawingKinds";

export function DrawingEditorHost() {
  const request = useViewerOverlayStore((state) => state.drawingEditor);
  if (!request) return null;
  const Host = DRAWING_SPECS[request.kind].Host;
  return <Host key={`${request.kind}:${request.objectId ?? "new"}`} objectId={request.objectId} />;
}
