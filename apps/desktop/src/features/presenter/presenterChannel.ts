import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { LiveSignal } from "@/features/viewer/presentation/liveSignal";
import { diffSlice, type SharedSlice, type StateMessage } from "./presenterSync";

export const PRESENTER_EVENTS = {
  state: "presenter:state",
  live: "presenter:live",
  ready: "presenter:ready",
  command: "presenter:command",
  closed: "presenter-closed",
} as const;

export const PRESENTER_COMMANDS = ["next", "previous", "first", "last", "blackoutBlack", "blackoutWhite", "clearBlackout", "end"] as const;

export type PresenterCommand = (typeof PRESENTER_COMMANDS)[number];

export type PresenterTransport = {
  send: (target: string, event: string, payload: unknown) => Promise<void>;
  listen: (event: string, handler: (payload: unknown) => void) => Promise<() => void>;
};

export type FrameScheduler = (flush: () => void) => () => void;

export const animationFrame: FrameScheduler = (flush) => {
  const frame = window.requestAnimationFrame(flush);
  return () => window.cancelAnimationFrame(frame);
};

export function isPresenterCommand(value: unknown): value is PresenterCommand {
  return typeof value === "string" && (PRESENTER_COMMANDS as readonly string[]).includes(value);
}

export function tauriTransport(): PresenterTransport {
  return {
    send: (target, event, payload) => emitTo(target, event, payload),
    listen: async (event, handler) => getCurrentWebviewWindow().listen(event, (message) => handler(message.payload)),
  };
}

export function memoryBus() {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const keyOf = (label: string, event: string) => `${label}\u0000${event}`;
  return (label: string): PresenterTransport => ({
    send: async (target, event, payload) => {
      handlers.get(keyOf(target, event))?.forEach((handler) => handler(structuredClone(payload)));
    },
    listen: async (event, handler) => {
      const key = keyOf(label, event);
      const set = handlers.get(key) ?? new Set();
      set.add(handler);
      handlers.set(key, set);
      return () => set.delete(handler);
    },
  });
}

type ConsoleLinkOptions = {
  transport: PresenterTransport;
  audience: string;
  read: () => SharedSlice;
  onCommand: (command: PresenterCommand) => void;
  onClosed?: () => void;
  schedule?: FrameScheduler;
};

export function createConsoleLink({ transport, audience, read, onCommand, onClosed, schedule = animationFrame }: ConsoleLinkOptions) {
  let sent: SharedSlice | null = null;
  let live: LiveSignal | null | undefined;
  let cancelFrame: (() => void) | null = null;
  let disposed = false;
  const stops: Array<() => void> = [];

  const post = (event: string, payload: unknown) => {
    void transport.send(audience, event, payload).catch(() => undefined);
  };

  const sendFull = () => {
    sent = read();
    const message: StateMessage = { kind: "full", slice: sent };
    post(PRESENTER_EVENTS.state, message);
  };

  const flush = () => {
    cancelFrame = null;
    if (disposed) return;
    if (sent) {
      const next = read();
      const patch = diffSlice(sent, next);
      sent = next;
      if (patch) post(PRESENTER_EVENTS.state, { kind: "patch", patch } satisfies StateMessage);
    }
    if (live !== undefined) {
      post(PRESENTER_EVENTS.live, live);
      live = undefined;
    }
  };

  const request = () => {
    if (disposed || cancelFrame) return;
    cancelFrame = schedule(flush);
  };

  const listen = (event: string, handler: (payload: unknown) => void) => {
    void transport.listen(event, handler).then((stop) => {
      if (disposed) stop();
      else stops.push(stop);
    });
  };

  listen(PRESENTER_EVENTS.ready, () => {
    if (!disposed) sendFull();
  });
  listen(PRESENTER_EVENTS.command, (payload) => {
    if (!disposed && isPresenterCommand(payload)) onCommand(payload);
  });
  listen(PRESENTER_EVENTS.closed, (payload) => {
    if (!disposed && payload === audience) onClosed?.();
  });

  return {
    stateChanged: request,
    live: (signal: LiveSignal | null) => {
      live = signal;
      request();
    },
    dispose: () => {
      disposed = true;
      cancelFrame?.();
      cancelFrame = null;
      stops.splice(0).forEach((stop) => stop());
    },
  };
}

type AudienceLinkOptions = {
  transport: PresenterTransport;
  console: string;
  onState: (message: StateMessage) => void;
  onLive: (signal: LiveSignal | null) => void;
};

function isStateMessage(value: unknown): value is StateMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as { kind?: unknown; slice?: unknown; patch?: unknown };
  if (message.kind === "full") return Boolean(message.slice) && typeof message.slice === "object";
  return message.kind === "patch" && Boolean(message.patch) && typeof message.patch === "object";
}

export async function createAudienceLink({ transport, console: consoleLabel, onState, onLive }: AudienceLinkOptions) {
  const stops = await Promise.all([
    transport.listen(PRESENTER_EVENTS.state, (payload) => {
      if (isStateMessage(payload)) onState(payload);
    }),
    transport.listen(PRESENTER_EVENTS.live, (payload) => onLive(payload && typeof payload === "object" ? (payload as LiveSignal) : null)),
  ]);
  const post = (event: string, payload: unknown) => transport.send(consoleLabel, event, payload).catch(() => undefined);
  return {
    ready: () => post(PRESENTER_EVENTS.ready, null),
    command: (command: PresenterCommand) => post(PRESENTER_EVENTS.command, command),
    dispose: () => stops.forEach((stop) => stop()),
  };
}
