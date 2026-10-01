import { describe, expect, it } from "vitest";
import { addedAttachmentNames, isAttachmentRemoved, isCommentDeleted, pendingChangesFor, pendingReplies, resolvedOverride, reviewStateOverride, usePendingChangesStore, type PendingChange } from "./pendingChangesStore";

const resolveOn: PendingChange = { id: "a", kind: "commentResolved", xrefs: [10], resolved: true, label: "x" };
const resolveOff: PendingChange = { id: "b", kind: "commentResolved", xrefs: [10], resolved: false, label: "x" };
const deleted: PendingChange = { id: "c", kind: "commentDeleted", xrefs: [11, 12], label: "x" };
const added: PendingChange = { id: "d", kind: "attachmentAdded", files: ["C:/tmp/a.txt"], label: "a.txt" };
const removed: PendingChange = { id: "e", kind: "attachmentRemoved", names: ["old.txt"], label: "old.txt" };

describe("pendingChangesFor", () => {
  it("returns an empty list for an unknown document", () => {
    expect(pendingChangesFor({}, "doc")).toEqual([]);
  });

  it("returns the queue for the document only", () => {
    expect(pendingChangesFor({ doc: [added], other: [removed] }, "doc")).toEqual([added]);
  });

  it("reuses one empty list so a store selector never sees a new reference", () => {
    expect(pendingChangesFor({}, "doc")).toBe(pendingChangesFor({ other: [added] }, "doc"));
  });
});

describe("store identity", () => {
  it("does not replace state when clearing a document with no queue", () => {
    const before = usePendingChangesStore.getState().changes;
    usePendingChangesStore.getState().clear("absent");
    expect(usePendingChangesStore.getState().changes).toBe(before);
  });

  it("queues and clears a change for one document", () => {
    usePendingChangesStore.getState().queue("doc", { kind: "commentDeleted", xrefs: [7], label: "x" });
    expect(pendingChangesFor(usePendingChangesStore.getState().changes, "doc")).toHaveLength(1);
    usePendingChangesStore.getState().clear("doc");
    expect(pendingChangesFor(usePendingChangesStore.getState().changes, "doc")).toHaveLength(0);
  });
});

describe("resolvedOverride", () => {
  it("reports no override when the comment is untouched", () => {
    expect(resolvedOverride([deleted], 10)).toBeNull();
  });

  it("takes the last queued value when a comment is toggled twice", () => {
    expect(resolvedOverride([resolveOn, resolveOff], 10)).toBe(false);
    expect(resolvedOverride([resolveOff, resolveOn], 10)).toBe(true);
  });
});

describe("reviewStateOverride", () => {
  const accepted: PendingChange = { id: "f", kind: "commentState", xrefs: [10, 13], state: "Accepted", label: "x" };
  const cleared: PendingChange = { id: "g", kind: "commentState", xrefs: [10], state: null, label: "x" };

  it("reports no override when the comment is untouched", () => {
    expect(reviewStateOverride([deleted, accepted], 99)).toBeNull();
  });

  it("follows the queue order across resolve toggles and state choices", () => {
    expect(reviewStateOverride([resolveOn, accepted], 10)).toEqual({ state: "Accepted" });
    expect(reviewStateOverride([accepted, resolveOn], 10)).toEqual({ state: "Completed" });
    expect(reviewStateOverride([accepted, cleared], 10)).toEqual({ state: null });
    expect(reviewStateOverride([accepted], 13)).toEqual({ state: "Accepted" });
  });

  it("keeps resolvedOverride in step with a chosen state", () => {
    expect(resolvedOverride([resolveOn, accepted], 10)).toBe(false);
    expect(resolvedOverride([accepted, { ...accepted, id: "h", state: "Completed" }], 10)).toBe(true);
  });
});

describe("pendingReplies", () => {
  it("lists queued replies in order and nothing else", () => {
    const first: PendingChange = { id: "r1", kind: "commentReply", parent: 10, content: "Yes", label: "x" };
    const second: PendingChange = { id: "r2", kind: "commentReply", parent: 11, content: "No", label: "x" };
    expect(pendingReplies([first, deleted, second, resolveOn])).toEqual([first, second]);
    expect(pendingReplies([deleted])).toEqual([]);
  });
});

describe("isCommentDeleted", () => {
  it("matches any xref in a queued delete", () => {
    expect(isCommentDeleted([deleted], 11)).toBe(true);
    expect(isCommentDeleted([deleted], 12)).toBe(true);
    expect(isCommentDeleted([deleted], 10)).toBe(false);
  });
});

describe("attachment helpers", () => {
  it("reports a queued removal by name", () => {
    expect(isAttachmentRemoved([removed], "old.txt")).toBe(true);
    expect(isAttachmentRemoved([removed], "kept.txt")).toBe(false);
  });

  it("collects queued additions", () => {
    expect(addedAttachmentNames([added, removed])).toEqual(["C:/tmp/a.txt"]);
    expect(addedAttachmentNames([removed])).toEqual([]);
  });
});
