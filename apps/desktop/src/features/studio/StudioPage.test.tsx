import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useDocumentStore } from "./document/documentStore";
import { createDocument } from "./document/model";
import { StudioPage } from "./StudioPage";

const { editorRenders } = vi.hoisted(() => ({ editorRenders: { count: 0 } }));

vi.mock("./document/DocumentEditor", () => ({
  default: function DocumentEditor() {
    editorRenders.count += 1;
    return <div data-testid="document-editor" />;
  },
}));

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

afterEach(() => {
  cleanup();
  act(() => useDocumentStore.getState().close());
  editorRenders.count = 0;
});

describe("StudioPage", () => {
  it("does not draw the document editor again for every change to the document's text", async () => {
    act(() => useDocumentStore.getState().open(createDocument("Notes")));
    render(<StudioPage />, { wrapper: MemoryRouter });
    await screen.findByTestId("document-editor");
    const before = editorRenders.count;

    act(() => {
      for (let key = 0; key < 5; key += 1) useDocumentStore.getState().setContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(key + 1) }] }] });
    });

    expect(editorRenders.count).toBe(before);
  });

  it("shows the document editor while a document is open and leaves it when the document closes", async () => {
    act(() => useDocumentStore.getState().open(createDocument("Notes")));
    render(<StudioPage />, { wrapper: MemoryRouter });
    await screen.findByTestId("document-editor");

    act(() => useDocumentStore.getState().close());

    expect(screen.queryByTestId("document-editor")).toBeNull();
  });
});
