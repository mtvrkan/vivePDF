import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { createDesign, createQr } from "../model/design";
import { parseVCard } from "../model/vcard";
import { QrSection } from "./QrSection";
import { useStudioStore } from "./studioStore";
import type { StudioQrElement } from "@/types/studio";

const qr = () => useStudioStore.getState().design?.pages[0].elements[0] as StudioQrElement;

function show() {
  cleanup();
  render(<QrSection element={qr()} />);
}

function content(name: string) {
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "QR content" })).getByRole("radio", { name }));
  show();
}

describe("QR contact card builder", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  beforeEach(() => {
    const design = createDesign("Card", 240, 155);
    const code = createQr("https://example.com", 20, 20, 80);
    useStudioStore.getState().open({ ...design, pages: [{ ...design.pages[0], elements: [code] }] });
    useStudioStore.getState().select([code.id]);
  });

  afterEach(() => {
    cleanup();
    useStudioStore.getState().close();
  });

  it("turns a link into a contact card that keeps the link as its website", () => {
    show();

    content("Contact card");
    fireEvent.change(screen.getByRole("textbox", { name: "First name" }), { target: { value: "Ada" } });

    expect(parseVCard(qr().value)).toMatchObject({ firstName: "Ada", website: "https://example.com" });
    expect(screen.getByTestId("studio-qr-contact")).toBeTruthy();
  });

  it("reads an existing vCard into the fields and back to its link as plain text", () => {
    const value = "BEGIN:VCARD\r\nVERSION:3.0\r\nN:Hopper;Grace;;;\r\nEMAIL:grace@example.com\r\nURL:https://navy.example\r\nEND:VCARD";
    const design = useStudioStore.getState().design;
    if (design) useStudioStore.getState().open({ ...design, pages: [{ ...design.pages[0], elements: [{ ...qr(), value }] }] });
    useStudioStore.getState().select([qr().id]);
    show();

    expect((screen.getByRole("textbox", { name: "Last name" }) as HTMLInputElement).value).toBe("Hopper");
    content("Text or link");

    expect(qr().value).toBe("https://navy.example");
  });
});
