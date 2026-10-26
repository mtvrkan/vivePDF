import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, useRef } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor, EditorContent, useEditor } from "@tiptap/react";
import { ready, setLocale } from "@/app/i18n";
import { storeCitationSource } from "./citationSource";
import { HorizontalRuler, VerticalRuler } from "./DocumentRuler";
import { useDocumentStore } from "./documentStore";
import { documentExtensions } from "./extensions";
import { createDocument, pageSize, POINTS_PER_MM } from "./model";

const SCALE = 4 / 3;
let editor: Editor | null = null;

function rect(width: number, height: number): DOMRect {
  return { left: 0, top: 0, x: 0, y: 0, width, height, right: width, bottom: height, toJSON: () => ({}) } as DOMRect;
}

async function mount(vertical = false) {
  useDocumentStore.getState().open(createDocument("Ruled"));
  const settings = useDocumentStore.getState().document!.settings;
  const size = pageSize(settings);
  const paper = createRef<HTMLDivElement>();
  const host = createRef<HTMLDivElement>();
  const sheet = document.createElement("div");
  document.body.append(sheet);
  editor = new Editor({ element: sheet, extensions: documentExtensions("", storeCitationSource("en", "References", "")), content: "<p>Indented paragraph</p>" });
  (paper as { current: HTMLDivElement | null }).current = sheet;
  (host as { current: HTMLDivElement | null }).current = sheet;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => rect(size.width * SCALE, size.height * SCALE));
  const props = { editor, settings, size, paper, host };
  render(vertical ? <VerticalRuler {...props} laid={null} lines={null} zoom={1} /> : <HorizontalRuler {...props} />);
  await act(() => new Promise((resolve) => setTimeout(resolve, 40)));
  return editor;
}

describe("document ruler", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    editor?.destroy();
    editor = null;
    document.body.innerHTML = "";
    useDocumentStore.getState().close();
  });

  it("moves the left margin and the bottom margin a millimetre per arrow key", async () => {
    await mount();
    fireEvent.keyDown(screen.getByRole("slider", { name: "Left margin" }), { key: "ArrowRight", shiftKey: true });
    expect(useDocumentStore.getState().document?.settings.marginLeftMm).toBe(25);
    cleanup();

    await mount(true);
    fireEvent.keyDown(screen.getByRole("slider", { name: "Bottom margin" }), { key: "ArrowUp" });
    expect(useDocumentStore.getState().document?.settings.marginBottomMm).toBe(21);
  });

  it("indents the caret's paragraph and makes a hanging first line", async () => {
    const current = await mount();
    act(() => {
      current.commands.setTextSelection(3);
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 40)));

    fireEvent.keyDown(screen.getByRole("slider", { name: "Hanging indent" }), { key: "ArrowRight", shiftKey: true });
    const attributes = current.getAttributes("paragraph");

    expect(attributes.indentLeft).toBeCloseTo(5 * POINTS_PER_MM, 1);
    expect(attributes.firstLineIndent).toBeCloseTo(-5 * POINTS_PER_MM, 1);
    expect(current.getHTML()).toContain("margin-left: 14.17pt");
    expect(current.getHTML()).toContain("text-indent: -14.17pt");
  });

  it("renders before the editor view is mounted without touching it", async () => {
    useDocumentStore.getState().open(createDocument("Early"));
    const settings = useDocumentStore.getState().document!.settings;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => rect(800, 1100));
    function Harness() {
      const paper = useRef<HTMLDivElement>(null);
      const current = useEditor({ extensions: documentExtensions("", storeCitationSource("en", "References", "")), content: "<p>Text</p>" });
      if (!current) return null;
      return (
        <>
          <HorizontalRuler editor={current} settings={settings} size={pageSize(settings)} paper={paper} host={paper} />
          <div ref={paper}>
            <EditorContent editor={current} />
          </div>
        </>
      );
    }

    render(<Harness />);
    await act(() => new Promise((resolve) => setTimeout(resolve, 40)));

    expect(screen.getByRole("slider", { name: "Left margin" })).toBeTruthy();
  });

  it("does not leave a guide behind after an arrow key", async () => {
    await mount();

    fireEvent.keyDown(screen.getByRole("slider", { name: "Right margin" }), { key: "ArrowLeft" });

    expect(useDocumentStore.getState().document?.settings.marginRightMm).toBe(21);
    expect(document.querySelector('[data-testid="document-ruler-guide"]')).toBeNull();
  });

  it("draws a guide on the sheet while a margin is dragged and removes it after", async () => {
    await mount();
    const handle = screen.getByTestId("ruler-margin-right");

    fireEvent.pointerDown(handle, { button: 0, clientX: 500 });
    expect(document.querySelector('[data-testid="document-ruler-guide"]')).not.toBeNull();
    fireEvent.pointerUp(handle);

    expect(document.querySelector('[data-testid="document-ruler-guide"]')).toBeNull();
    expect(useDocumentStore.getState().document?.settings.marginRightMm).toBeGreaterThan(20);
  });
});
