export function outsideRender(update: () => void): void {
  queueMicrotask(update);
}
