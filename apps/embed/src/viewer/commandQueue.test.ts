import { describe, expect, it } from "vitest";
import { CommandQueue } from "./commandQueue";

describe("CommandQueue", () => {
  it("holds commands until someone listens and then hands them over in order", () => {
    const queue = new CommandQueue<number>();
    const seen: number[] = [];
    queue.push(1);
    queue.push(2);

    queue.listen((command) => seen.push(command));
    queue.push(3);

    expect(seen).toEqual([1, 2, 3]);
  });

  it("keeps commands for the next listener once the last one stopped listening", () => {
    const queue = new CommandQueue<string>();
    const first: string[] = [];
    const second: string[] = [];
    const stop = queue.listen((command) => first.push(command));
    stop();

    queue.push("goTo");
    queue.listen((command) => second.push(command));

    expect(first).toEqual([]);
    expect(second).toEqual(["goTo"]);
  });

  it("does not let an old listener's stop remove a newer listener", () => {
    const queue = new CommandQueue<string>();
    const seen: string[] = [];
    const stopOld = queue.listen(() => {});
    queue.listen((command) => seen.push(command));

    stopOld();
    queue.push("print");

    expect(seen).toEqual(["print"]);
  });
});
