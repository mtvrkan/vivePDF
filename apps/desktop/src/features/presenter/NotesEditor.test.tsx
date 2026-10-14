import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";

const readNotes = vi.hoisted(() => vi.fn());
const writeNotes = vi.hoisted(() => vi.fn());

vi.mock("./presenterNotes", async (importOriginal) => ({ ...(await importOriginal<typeof import("./presenterNotes")>()), readNotes, writeNotes }));

const { NotesEditor } = await import("./NotesEditor");

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("NotesEditor", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  beforeEach(() => {
    readNotes.mockReset();
    writeNotes.mockReset();
    writeNotes.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows a skeleton while loading, then the note of the current page", async () => {
    let resolve: (notes: Record<number, string>) => void = () => undefined;
    readNotes.mockReturnValue(new Promise((done) => (resolve = done)));
    render(<NotesEditor path="C:/talks/deck.pdf" pageIndex={2} pageCount={5} />);
    expect(screen.getByTestId("notes-skeleton")).toBeTruthy();

    await act(async () => resolve({ 2: "Mention the budget" }));

    expect(screen.queryByTestId("notes-skeleton")).toBeNull();
    expect((screen.getByLabelText("Speaker notes") as HTMLTextAreaElement).value).toBe("Mention the budget");
    expect(readNotes).toHaveBeenCalledWith("C:/talks/deck.pdf");
  });

  it("saves once after typing stops and keeps the other pages' notes", async () => {
    vi.useFakeTimers();
    readNotes.mockResolvedValue({ 0: "Welcome" });
    render(<NotesEditor path="C:/talks/deck.pdf" pageIndex={1} pageCount={4} />);
    await settle();
    const field = screen.getByLabelText("Speaker notes");

    fireEvent.change(field, { target: { value: "Sec" } });
    act(() => vi.advanceTimersByTime(300));
    fireEvent.change(field, { target: { value: "Second slide" } });
    act(() => vi.advanceTimersByTime(300));
    expect(writeNotes).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(300));
    await settle();

    expect(writeNotes).toHaveBeenCalledTimes(1);
    expect(writeNotes).toHaveBeenCalledWith("C:/talks/deck.pdf", { 0: "Welcome", 1: "Second slide" }, 4);
    expect(screen.getByRole("status").textContent).toBe("Saved");
    expect(screen.getByText("12 / 20000")).toBeTruthy();
  });

  it("caps a note at the size limit", async () => {
    readNotes.mockResolvedValue({});
    render(<NotesEditor path="C:/talks/deck.pdf" pageIndex={0} pageCount={1} />);
    await settle();

    const field = screen.getByLabelText("Speaker notes") as HTMLTextAreaElement;

    expect(field.maxLength).toBe(20000);
    fireEvent.change(field, { target: { value: "x".repeat(20050) } });
    expect(field.value).toHaveLength(20000);
  });

  it("writes pending changes when it closes before the delay", async () => {
    readNotes.mockResolvedValue({});
    const { unmount } = render(<NotesEditor path="C:/talks/deck.pdf" pageIndex={0} pageCount={2} />);
    await settle();
    fireEvent.change(screen.getByLabelText("Speaker notes"), { target: { value: "Last words" } });

    unmount();
    await settle();

    expect(writeNotes).toHaveBeenCalledWith("C:/talks/deck.pdf", { 0: "Last words" }, 2);
  });

  it("offers a retry when the notes cannot be read and says when a save fails", async () => {
    readNotes.mockRejectedValueOnce(new Error("disk")).mockResolvedValueOnce({});
    writeNotes.mockRejectedValue(new Error("full"));
    render(<NotesEditor path="C:/talks/deck.pdf" pageIndex={0} pageCount={1} />);
    await settle();
    expect(screen.getByRole("alert").textContent).toContain("Your notes could not be loaded.");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await settle();
    const field = screen.getByLabelText("Speaker notes");
    fireEvent.change(field, { target: { value: "Hello" } });
    fireEvent.blur(field);
    await settle();

    expect(screen.getByRole("alert").textContent).toBe("Your notes could not be saved.");
  });
});
