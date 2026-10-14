import { describe, expect, it, vi } from "vitest";
import { createAudienceLink, createConsoleLink, memoryBus, PRESENTER_EVENTS, type FrameScheduler } from "./presenterChannel";
import type { SharedSlice, StateMessage } from "./presenterSync";

function slice(page: number): SharedSlice {
  return {
    page,
    blackout: "none",
    strokesByPage: {},
    boardStrokes: { black: [], white: [] },
    laserColor: "#E5484D",
    laserSize: 8,
    spotlightRadius: 180,
    spotlightShape: "circle",
    spotlightDim: 0.78,
    magnifierSize: 220,
    magnifierZoom: 2.5,
    magnifierShape: "circle",
  };
}

function manualFrames() {
  const pending: Array<() => void> = [];
  const schedule: FrameScheduler = (flush) => {
    pending.push(flush);
    return () => pending.splice(pending.indexOf(flush), 1);
  };
  return { schedule, run: () => pending.splice(0).forEach((flush) => flush()), count: () => pending.length };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function connect(read: () => SharedSlice) {
  const bus = memoryBus();
  const frames = manualFrames();
  const commands = vi.fn();
  const closed = vi.fn();
  const link = createConsoleLink({ transport: bus("main"), audience: "present-a", read, onCommand: commands, onClosed: closed, schedule: frames.schedule });
  await tick();
  const states: StateMessage[] = [];
  const lives: unknown[] = [];
  const audience = await createAudienceLink({ transport: bus("present-a"), console: "main", onState: (message) => states.push(message), onLive: (signal) => lives.push(signal) });
  return { bus, frames, commands, closed, link, audience, states, lives };
}

describe("presenterChannel", () => {
  it("answers the audience's ready with a full snapshot, then sends one patch per frame", async () => {
    let page = 1;
    const { frames, link, audience, states } = await connect(() => slice(page));

    await audience.ready();
    page = 2;
    link.stateChanged();
    page = 3;
    link.stateChanged();
    expect(frames.count()).toBe(1);
    frames.run();

    expect(states).toEqual([
      { kind: "full", slice: slice(1) },
      { kind: "patch", patch: { page: 3 } },
    ]);
  });

  it("holds patches until the audience has asked for its snapshot", async () => {
    const { frames, link, audience, states, lives } = await connect(() => slice(4));

    link.stateChanged();
    link.live(null);
    frames.run();
    await audience.ready();

    expect(states).toEqual([{ kind: "full", slice: slice(4) }]);
    expect(lives).toEqual([null]);
  });

  it("passes known commands to the console and drops anything else", async () => {
    const { bus, commands, audience } = await connect(() => slice(1));

    await audience.command("next");
    await bus("present-a").send("main", PRESENTER_EVENTS.command, "rm -rf");
    await bus("present-a").send("main", PRESENTER_EVENTS.command, { command: "next" });

    expect(commands.mock.calls).toEqual([["next"]]);
  });

  it("reports only its own audience closing and stops after dispose", async () => {
    const { bus, closed, link, audience, frames, states } = await connect(() => slice(1));

    await bus("rust").send("main", PRESENTER_EVENTS.closed, "present-other");
    await bus("rust").send("main", PRESENTER_EVENTS.closed, "present-a");
    link.dispose();
    await audience.ready();
    link.stateChanged();
    frames.run();

    expect(closed).toHaveBeenCalledTimes(1);
    expect(states).toEqual([]);
  });

  it("tells the console when the audience could not show the file", async () => {
    const bus = memoryBus();
    const failed = vi.fn();
    const link = createConsoleLink({ transport: bus("main"), audience: "present-a", read: () => slice(1), onCommand: vi.fn(), onFailed: failed, schedule: manualFrames().schedule });
    await tick();
    const audience = await createAudienceLink({ transport: bus("present-a"), console: "main", onState: vi.fn(), onLive: vi.fn() });

    await audience.failed();
    link.dispose();
    await audience.failed();

    expect(failed).toHaveBeenCalledTimes(1);
  });
});
