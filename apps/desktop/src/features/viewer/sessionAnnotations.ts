export type SessionAnnotation = { pageIndex: number; id: string };
export type SessionAnnotationEvent = { type: string; pageIndex: number; annotation: { id: string } };

export function trackSessionAnnotation(current: SessionAnnotation[], event: SessionAnnotationEvent): SessionAnnotation[] {
  if (event.type === "create") {
    if (current.some((item) => item.id === event.annotation.id)) return current;
    return [...current, { pageIndex: event.pageIndex, id: event.annotation.id }];
  }
  if (event.type === "delete") {
    const next = current.filter((item) => item.id !== event.annotation.id);
    return next.length === current.length ? current : next;
  }
  return current;
}
