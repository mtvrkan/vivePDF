import { useScroll } from "@embedpdf/plugin-scroll/react";
import { NotesEditor } from "@/features/presenter/NotesEditor";
import { sessionPathOf } from "@/features/viewer/convertedDocuments";
import { cn } from "@/shared/lib/cn";
import { useDocumentStore } from "@/shared/store/documentStore";
import { usePresentationStore } from "@/shared/store/presentationStore";

export function SoloNotesPanel({ documentId, className }: { documentId: string; className?: string }) {
  const open = usePresentationStore((state) => state.notesOpen);
  const path = useDocumentStore((state) => state.documents[documentId]?.path);
  const { state: scrollState } = useScroll(documentId);
  if (!open || !path) return null;

  return (
    <div data-testid="solo-notes" className={cn("glass select-pop pointer-events-auto fixed bottom-20 start-4 flex h-64 w-96 max-w-[calc(100vw-2rem)] origin-bottom flex-col rounded-2xl p-3", className)}>
      <NotesEditor path={sessionPathOf(path)} pageIndex={scrollState.currentPage - 1} pageCount={scrollState.totalPages} />
    </div>
  );
}
