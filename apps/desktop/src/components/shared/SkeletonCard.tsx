type SkeletonCardProps = {
  lines?: number;
  numeral?: boolean;
};

export function SkeletonCard({ lines = 4, numeral = false }: SkeletonCardProps) {
  return (
    <div aria-busy className="animate-pulse rounded-md border bg-card p-4">
      {numeral ? <div className="mb-4 h-12 w-24 rounded-sm bg-muted" /> : null}
      <div className="space-y-2">
        {Array.from({ length: lines }, (_, index) => (
          <div
            key={index}
            className="h-row border-b last:border-b-0"
          >
            <div className="mt-2.5 h-4 rounded-sm bg-muted" style={{ width: `${70 - index * 10}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
