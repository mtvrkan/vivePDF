export type SnapGuidesProps = {
  guides: { x: number[]; y: number[] };
  scale: number;
  width: number;
  height: number;
};

export function SnapGuides({ guides, scale, width, height }: SnapGuidesProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {guides.x.map((value, index) => (
        <div key={`x-${index}-${value}`} className="absolute top-0 w-px bg-primary" style={{ left: value * scale, height }} />
      ))}
      {guides.y.map((value, index) => (
        <div key={`y-${index}-${value}`} className="absolute left-0 h-px bg-primary" style={{ top: value * scale, width }} />
      ))}
    </div>
  );
}
