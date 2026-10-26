import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useDocumentStore } from "./documentStore";
import { createDocument, uniformMargins } from "./model";
import { PageSetupDialog } from "./PageSetupDialog";

function setNumber(label: string, value: string) {
  const input = screen.getByLabelText(new RegExp(`^${label}(mm)?$`));
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
}

const settings = () => useDocumentStore.getState().document?.settings;

describe("page setup dialog", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  afterEach(() => {
    cleanup();
    useDocumentStore.getState().close();
  });

  it("sets each margin and the gutter on its own", () => {
    useDocumentStore.getState().open(createDocument("Thesis"));
    render(<PageSetupDialog open onClose={() => undefined} />);

    setNumber("Left", "35");
    setNumber("Gutter", "10");
    fireEvent.click(screen.getByRole("radio", { name: "Top" }));

    expect(settings()).toMatchObject({ marginLeftMm: 35, marginRightMm: 20, marginTopMm: 20, gutterMm: 10, gutterSide: "top" });
    expect(screen.getByTestId("page-setup-preview")).toBeTruthy();
  });

  it("warns when the margins leave almost no room for text", () => {
    useDocumentStore.getState().open(createDocument("Narrow", "", { paper: "a5", ...uniformMargins(60), gutterMm: 10 }));
    render(<PageSetupDialog open onClose={() => undefined} />);

    expect(screen.getByTestId("page-setup-too-small").textContent).toContain("too little room");
  });

  it("changes the paper and the columns on their own tabs", () => {
    useDocumentStore.getState().open(createDocument("Paper"));
    render(<PageSetupDialog open onClose={() => undefined} />);

    fireEvent.click(screen.getByTestId("page-setup-paper"));
    expect(screen.getByText("210 × 297 mm")).toBeTruthy();
    fireEvent.click(screen.getByTestId("page-setup-layout"));
    fireEvent.click(screen.getByRole("radio", { name: "2" }));

    expect(settings()?.columns).toBe(2);
    expect(screen.queryByLabelText(/^Left/)).toBeNull();
  });
});
