import { useCallback } from "react";
import { useOpenPdf } from "@/features/viewer/useOpenPdf";
import { useViewerJumpStore } from "@/shared/store/viewerJumpStore";

export function useOpenAtPage(path: string) {
  const { openPath } = useOpenPdf();
  return useCallback(
    (page: number) => {
      useViewerJumpStore.getState().request({ path, page });
      void openPath(path);
    },
    [openPath, path],
  );
}
