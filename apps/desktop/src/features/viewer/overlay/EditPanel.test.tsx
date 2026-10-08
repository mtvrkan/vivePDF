import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useViewerOverlayStore, type EditorPending } from "@/shared/store/viewerOverlayStore";
import { layerKey } from "./layers";

vi.mock("./LayersPanel", () => ({ LayersPanel: () => null }));
vi.mock("@/shared/rpc/operations", () => ({ editorFontPlan: vi.fn(() => new Promise(() => undefined)) }));

const { EditPanel } = await import("./EditPanel");

const image: EditorPending = { id: "i1", kind: "image", pageIndex: 0, x: 20, y: 30, width: 100, height: 50, dataUrl: "", path: null, aspect: 2, opacity: 1 };

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  useViewerOverlayStore.setState({ objects: [image], selectedObjectId: "i1", lockedLayerKeys: {}, past: [], future: [] });
});

afterEach(cleanup);

describe("EditPanel geometry", () => {
  it("moves an unlocked object from the position field", () => {
    render(<EditPanel documentId="d" />);
    const x = screen.getAllByRole("textbox")[0] as HTMLInputElement;

    fireEvent.blur(x, { target: { value: "40" } });

    expect(useViewerOverlayStore.getState().objects[0].x).toBe(40);
  });

  it("keeps a locked layer's position, size and opacity fields read-only", () => {
    useViewerOverlayStore.setState({ lockedLayerKeys: { [layerKey(0, "i1")]: true } });
    render(<EditPanel documentId="d" />);
    const fields = screen.getAllByRole("textbox") as HTMLInputElement[];

    fireEvent.blur(fields[0], { target: { value: "40" } });

    expect(fields.slice(0, 4).every((field) => field.disabled)).toBe(true);
    expect((screen.getByRole("slider") as HTMLInputElement).disabled).toBe(true);
    expect(useViewerOverlayStore.getState().objects[0]).toMatchObject({ x: 20, opacity: 1 });
  });
});
