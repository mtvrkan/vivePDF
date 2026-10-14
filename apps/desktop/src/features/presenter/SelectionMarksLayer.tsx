import type { SelectionMarks } from "./selectionMarks";

export function SelectionMarksLayer({ marks, pageIndex }: { marks: SelectionMarks | null | undefined; pageIndex: number }) {
  const rects = marks?.pages[pageIndex];
  if (!marks || !rects || rects.length === 0) return null;
  return (
    <div aria-hidden data-remote-selection="" className="pointer-events-none absolute inset-0">
      {rects.map((rect, index) => (
        <div
          key={index}
          className="absolute"
          style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%`, background: marks.color, mixBlendMode: "multiply" }}
        />
      ))}
    </div>
  );
}
