export type HitKind = "image" | "text";
export type HitRect = { x: number; y: number; width: number; height: number };
export type HitCandidate = { id: string; kind: HitKind; rect: HitRect };
export type HitPoint = { x: number; y: number };

const BACKGROUND_IMAGE_AREA_RATIO = 0.85;

function rectArea(rect: HitRect): number {
  return rect.width * rect.height;
}

function containsPoint(rect: HitRect, point: HitPoint, tolerance: number): boolean {
  return (
    point.x >= rect.x - tolerance &&
    point.x <= rect.x + rect.width + tolerance &&
    point.y >= rect.y - tolerance &&
    point.y <= rect.y + rect.height + tolerance
  );
}

export function resolveOverlayHit(point: HitPoint, candidates: HitCandidate[], pageArea: number, tolerance = 0, allowedKind: HitKind | null = null): string | null {
  const hitting = candidates.filter((candidate) => containsPoint(candidate.rect, point, tolerance) && (!allowedKind || candidate.kind === allowedKind));
  if (hitting.length === 0) return null;
  const textHits = hitting.filter((candidate) => candidate.kind === "text");
  const eligible = hitting.filter((candidate) => {
    if (candidate.kind !== "image" || pageArea <= 0) return true;
    const isBackground = rectArea(candidate.rect) / pageArea >= BACKGROUND_IMAGE_AREA_RATIO;
    return !isBackground || textHits.length === 0;
  });
  if (eligible.length === 0) return null;
  return eligible.reduce((smallest, candidate) => (rectArea(candidate.rect) < rectArea(smallest.rect) ? candidate : smallest)).id;
}

export type HitSource<T> = { id: string; kind: HitKind; rect: HitRect; value: T };
export type LayerHit<O, B> = { source: "object"; value: O } | { source: "block"; value: B };

export function pickLayerHit<O, B>(point: HitPoint, objects: HitSource<O>[], blocks: HitSource<B>[], pageArea: number, tolerance = 0, allowedKind: HitKind | null = null): LayerHit<O, B> | null {
  const winnerId = resolveOverlayHit(point, [...objects, ...blocks], pageArea, tolerance, allowedKind);
  if (!winnerId) return null;
  const object = objects.find((entry) => entry.id === winnerId);
  if (object) return { source: "object", value: object.value };
  const block = blocks.find((entry) => entry.id === winnerId);
  return block ? { source: "block", value: block.value } : null;
}
