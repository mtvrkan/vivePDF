export class CommandQueue<T> {
  private pending: T[] = [];
  private handler: ((command: T) => void) | null = null;

  push(command: T): void {
    if (this.handler) this.handler(command);
    else this.pending.push(command);
  }

  listen(handler: (command: T) => void): () => void {
    this.handler = handler;
    const queued = this.pending;
    this.pending = [];
    for (const command of queued) handler(command);
    return () => {
      if (this.handler === handler) this.handler = null;
    };
  }
}
