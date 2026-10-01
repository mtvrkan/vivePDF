import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { axeViolations } from "@/test/axe";
import { ImageAltButton } from "./ImageAltButton";

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

afterEach(cleanup);

function Harness({ initial = "", onBegin = () => undefined, onAlt }: { initial?: string; onBegin?: () => void; onAlt?: (alt: string) => void }) {
  const [alt, setAlt] = useState(initial);
  return (
    <ImageAltButton
      value={alt}
      onBegin={onBegin}
      onChange={(next) => {
        setAlt(next);
        onAlt?.(next);
      }}
    />
  );
}

describe("ImageAltButton", () => {
  it("opens a described field and passes the typed alt text on", async () => {
    const onBegin = vi.fn();
    const onAlt = vi.fn();
    const { container } = render(<Harness onBegin={onBegin} onAlt={onAlt} />);

    fireEvent.click(screen.getByRole("button", { name: "Alt text" }));
    const field = screen.getByRole("textbox", { name: "Alt text" });
    fireEvent.change(field, { target: { value: "Map of the campus" } });

    expect(onBegin).toHaveBeenCalledTimes(1);
    expect(onAlt).toHaveBeenLastCalledWith("Map of the campus");
    expect(field.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Alt text" })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows the button as set only when the text is not blank", () => {
    render(<Harness initial="   " />);
    expect(screen.getByRole("button", { name: "Alt text" }).getAttribute("aria-pressed")).toBeNull();

    cleanup();
    render(<Harness initial="Logo" />);
    expect(screen.getByRole("button", { name: "Alt text" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("closes on Escape and caps the text at the PDF limit", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Alt text" }));
    const field = screen.getByRole("textbox", { name: "Alt text" });

    expect(field.getAttribute("maxLength")).toBe("2000");
    fireEvent.keyDown(field, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
