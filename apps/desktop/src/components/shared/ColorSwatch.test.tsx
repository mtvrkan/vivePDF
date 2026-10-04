import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColorSwatch } from "./ColorSwatch";

afterEach(cleanup);

describe("ColorSwatch", () => {
  it("works as before without the optional rows", () => {
    const onChange = vi.fn();
    render(<ColorSwatch value="#ff0000" onChange={onChange} label="Ink" customLabel="Custom" />);

    fireEvent.click(screen.getByRole("button", { name: "Ink: #ff0000" }));
    fireEvent.click(screen.getByRole("button", { name: "#0090ff" }));

    expect(onChange).toHaveBeenCalledWith("#0090ff");
    expect(screen.queryByText("Recent")).toBeNull();
  });

  it("shows extra rows read when it opens and reports the final colour once it closes", () => {
    const onCommit = vi.fn();
    const rows = vi.fn(() => [
      { id: "document", label: "Document", colors: ["#123456", "#ABCDEF", "#abcdef"] },
      { id: "recent", label: "Recent", colors: [] },
    ]);
    const { rerender } = render(<ColorSwatch value="#ff0000" onChange={vi.fn()} label="Ink" customLabel="Custom" rows={rows} onCommit={onCommit} />);

    expect(rows).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ink: #ff0000" }));
    expect(screen.getByText("Document")).toBeTruthy();
    expect(screen.queryByText("Recent")).toBeNull();
    expect(screen.getAllByRole("button", { name: "#abcdef" })).toHaveLength(1);

    rerender(<ColorSwatch value="#123456" onChange={vi.fn()} label="Ink" customLabel="Custom" rows={rows} onCommit={onCommit} />);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onCommit).toHaveBeenCalledExactlyOnceWith("#123456");
  });

  it("does not report a colour when the picker closes unchanged and can show a mixed value", () => {
    const onCommit = vi.fn();
    render(<ColorSwatch value="#ff0000" onChange={vi.fn()} label="Ink" customLabel="Custom" onCommit={onCommit} mixed mixedLabel="Mixed" />);
    const trigger = screen.getByRole("button", { name: "Ink: Mixed" });

    fireEvent.click(trigger);
    expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(0);
    fireEvent.click(trigger);

    expect(onCommit).not.toHaveBeenCalled();
  });
});
