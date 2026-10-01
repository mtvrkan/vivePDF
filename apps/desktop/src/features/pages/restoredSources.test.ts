import { beforeEach, describe, expect, it } from "vitest";
import type { OrganizerSource, OrganizerTile } from "@/types";
import { MAIN_SOURCE_ID, useOrganizerStore } from "./organizerStore";
import { sourcesToReattach } from "./useRestoredSources";

const main = { id: MAIN_SOURCE_ID, path: "C:/docs/main.pdf", fileName: "main.pdf", pageCount: 2 };
const locked = { id: "s-lock", path: "C:/docs/locked.pdf", fileName: "locked.pdf", pageCount: 1 };
const tiles: OrganizerTile[] = [
  { key: "p1", kind: "page", sourceId: MAIN_SOURCE_ID, index: 1, rotate: 0 },
  { key: "x1", kind: "page", sourceId: locked.id, index: 1, rotate: 0 },
];

function restored() {
  useOrganizerStore.getState().restore({ mainPath: main.path, tiles, sources: [main, locked], selected: [] }, "doc-main", "main-secret");
}

describe("restored organizer sources", () => {
  beforeEach(() => {
    useOrganizerStore.getState().clear();
    restored();
  });

  it("keeps only the main password and asks to reopen every inserted file", () => {
    const { sources, unavailable } = useOrganizerStore.getState();
    expect(sources[MAIN_SOURCE_ID].password).toBe("main-secret");
    expect(sources[locked.id]).toMatchObject({ password: null, embedDocId: null });
    expect(sourcesToReattach(sources, unavailable, new Set()).map((source) => source.id)).toEqual([locked.id]);
    expect(sourcesToReattach(sources, unavailable, new Set([locked.id]))).toEqual([]);
  });

  it("stores the password and preview document once the file is reopened", () => {
    useOrganizerStore.getState().markUnavailable(locked.id);
    useOrganizerStore.getState().attachSource(locked.id, { embedDocId: "src-1", password: "secret" });
    const { sources, unavailable } = useOrganizerStore.getState();
    expect(sources[locked.id]).toMatchObject({ password: "secret", embedDocId: "src-1" });
    expect(unavailable.has(locked.id)).toBe(false);
    expect(sourcesToReattach(sources, unavailable, new Set())).toEqual([]);
  });

  it("stops retrying a skipped file and ignores ids that are gone", () => {
    const state = useOrganizerStore.getState();
    state.markUnavailable(locked.id);
    state.markUnavailable("s-gone");
    state.attachSource("s-gone", { embedDocId: "src-2", password: null });
    const after = useOrganizerStore.getState();
    expect([...after.unavailable]).toEqual([locked.id]);
    expect(after.sources["s-gone" as keyof typeof after.sources] as OrganizerSource | undefined).toBeUndefined();
    expect(sourcesToReattach(after.sources, after.unavailable, new Set())).toEqual([]);
    restored();
    expect(useOrganizerStore.getState().unavailable.size).toBe(0);
  });
});
