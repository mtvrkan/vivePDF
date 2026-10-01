import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REVOKE_GRACE_MS, YOUNG_BLOB_MS, installBlobUrlGuard } from "./blobUrlGuard";

let clock = 0;
let counter = 0;
const revoked: string[] = [];
const api = {
  createObjectURL: (() => `blob:test/${(counter += 1)}`) as typeof URL.createObjectURL,
  revokeObjectURL: ((url: string) => void revoked.push(url)) as typeof URL.revokeObjectURL,
};
let uninstall: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
  revoked.length = 0;
  uninstall = installBlobUrlGuard(api, () => clock);
});

afterEach(() => {
  uninstall();
  vi.useRealTimers();
});

describe("installBlobUrlGuard", () => {
  it("lets a picture that was handed a just-created address finish loading before the address is released", () => {
    const url = api.createObjectURL(new Blob());
    clock += 1;

    api.revokeObjectURL(url);

    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(REVOKE_GRACE_MS);
    expect(revoked).toEqual([url]);
  });

  it("releases an older address at once", () => {
    const url = api.createObjectURL(new Blob());
    clock += YOUNG_BLOB_MS;

    api.revokeObjectURL(url);

    expect(revoked).toEqual([url]);
  });

  it("releases an address it never saw created at once, and restores the originals when removed", () => {
    api.revokeObjectURL("blob:elsewhere/1");
    expect(revoked).toEqual(["blob:elsewhere/1"]);

    uninstall();
    const url = api.createObjectURL(new Blob());
    api.revokeObjectURL(url);
    expect(revoked).toEqual(["blob:elsewhere/1", url]);
    uninstall = () => undefined;
  });
});
