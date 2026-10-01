import { useDocumentMessagesStore } from "@/shared/store/documentMessagesStore";

export function FieldHighlights({ documentId, pageIndex }: { documentId: string; pageIndex: number }) {
  const highlight = useDocumentMessagesStore((state) => state.highlights[documentId] ?? null);
  if (highlight?.state !== "shown") return null;
  const boxes = highlight.boxes.filter((box) => box.page === pageIndex + 1);
  if (boxes.length === 0) return null;
  return (
    <div aria-hidden data-field-highlights="" className="pointer-events-none absolute inset-0">
      {boxes.map((box, index) => (
        <div
          key={`${box.name}-${index}`}
          data-field-box={box.name}
          className="absolute rounded-sm border border-primary/60 bg-primary/15"
          style={{ left: `${box.left * 100}%`, top: `${box.top * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}
        />
      ))}
    </div>
  );
}
