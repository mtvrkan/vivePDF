import { describe, expect, it } from "vitest";
import { engineFailure, problemFromEngine, problemFromStatus } from "./openError";

describe("problemFromEngine", () => {
  it("asks for a password first and reports a wrong one after", () => {
    const problems = [problemFromEngine({ code: 4 }, false), problemFromEngine({ code: 4 }, true)];

    expect(problems).toEqual(["password", "wrongPassword"]);
  });

  it("tells a missing file apart from other network failures", () => {
    const problems = [
      problemFromEngine({ code: 2, message: "Error: range request answered 404" }, false),
      problemFromEngine({ code: 2, message: "Error: range request answered 503" }, false),
      problemFromEngine({ code: 2, message: "Failed to fetch" }, false),
    ];

    expect(problems).toEqual(["notFound", "network", "network"]);
  });

  it("calls a file the engine cannot parse damaged and anything else unknown", () => {
    const problems = [problemFromEngine({ code: 3 }, false), problemFromEngine({ code: 1 }, false), problemFromEngine(undefined, false)];

    expect(problems).toEqual(["damaged", "unknown", "unknown"]);
  });
});

describe("problemFromStatus", () => {
  it("treats 404 and 410 as not found and other statuses as network trouble", () => {
    expect([404, 410, 403, 500].map(problemFromStatus)).toEqual(["notFound", "notFound", "network", "network"]);
  });
});

describe("engineFailure", () => {
  it("reads the code and message from a rejected task or a bare reason", () => {
    const failures = [engineFailure({ name: "TaskRejectedError", reason: { code: 4, message: "locked" } }), engineFailure({ code: 3 }), engineFailure("boom")];

    expect(failures).toEqual([{ code: 4, message: "locked" }, { code: 3, message: undefined }, undefined]);
  });
});
