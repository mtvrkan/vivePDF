import { useCallback, useEffect, useRef } from "react";
import { useRegistry } from "@embedpdf/core/react";
import { useScroll } from "@embedpdf/plugin-scroll/react";
import { useSelectionCapability } from "@embedpdf/plugin-selection/react";
import { exitImmersive } from "@/features/viewer/immersive";
import type { LiveSignal } from "@/features/viewer/presentation/liveSignal";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import { usePresentationStore } from "@/shared/store/presentationStore";
import { applyCommand } from "./presenterCommands";
import { createConsoleLink, tauriTransport, type PresenterTransport } from "./presenterChannel";
import { usePresenterStore } from "./presenterSession";
import { sharedSlice } from "./presenterSync";
import { toSelectionMarks, type SelectionMarks } from "./selectionMarks";

export function usePresenterConsole(documentId: string, transport?: PresenterTransport) {
  const audience = usePresenterStore((state) => state.session?.audience ?? null);
  const { state: scrollState, provides: scroll } = useScroll(documentId);
  const scrollRef = useRef({ scroll, scrollState });
  scrollRef.current = { scroll, scrollState };
  const transportRef = useRef(transport);
  transportRef.current = transport;
  const linkRef = useRef<ReturnType<typeof createConsoleLink> | null>(null);
  const { provides: selection } = useSelectionCapability();
  const { documents } = useRegistry();
  const documentsRef = useRef(documents);
  documentsRef.current = documents;
  const selectionRef = useRef<SelectionMarks | null>(null);

  useEffect(() => {
    if (!audience) return;
    const link = createConsoleLink({
      transport: transportRef.current ?? tauriTransport(),
      audience,
      read: () => sharedSlice(usePresentationStore.getState(), scrollRef.current.scrollState.currentPage, selectionRef.current),
      onCommand: (command) => {
        const { scroll: current, scrollState: state } = scrollRef.current;
        const presentation = usePresentationStore.getState();
        applyCommand(command, {
          currentPage: state.currentPage,
          totalPages: state.totalPages,
          goToPage: (pageNumber) => current?.scrollToPage({ pageNumber }),
          toggleBlackout: presentation.toggleBlackout,
          clearBlackout: () => presentation.setBlackout("none"),
          end: () => void exitImmersive(),
        });
      },
      onClosed: () => usePresenterStore.getState().markProblem("closed"),
      onFailed: () => usePresenterStore.getState().markProblem("failed"),
    });
    linkRef.current = link;
    const unsubscribe = usePresentationStore.subscribe(() => link.stateChanged());
    return () => {
      unsubscribe();
      link.dispose();
      linkRef.current = null;
    };
  }, [audience]);

  useEffect(() => {
    linkRef.current?.stateChanged();
  }, [scrollState.currentPage]);

  useEffect(() => {
    if (!selection) return;
    const scope = selection.forDocument(documentId);
    const pageSize = (pageIndex: number) => documentsRef.current[documentId]?.document?.pages[pageIndex]?.size ?? null;
    const unsubscribe = scope.onSelectionChange(() => {
      selectionRef.current = toSelectionMarks(scope.getHighlightRects() as Parameters<typeof toSelectionMarks>[0], pageSize, usePreferencesStore.getState().selectionColor);
      linkRef.current?.stateChanged();
    });
    return () => {
      unsubscribe();
      selectionRef.current = null;
    };
  }, [selection, documentId]);

  return useCallback((signal: LiveSignal) => linkRef.current?.live(signal), []);
}
