import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { createDesign } from "../model/design";
import { ElementsPanel } from "./ElementsPanel";
import { useStudioStore } from "./studioStore";

vi.mock("../templates/TemplateGallery", () => ({ TemplateGallery: () => <p>gallery</p> }));
vi.mock("../merge/DataTab", () => ({ DataTab: () => <p>data</p> }));
vi.mock("./LayersTab", () => ({ LayersTab: () => <p>layers</p> }));

const panel = () => screen.getByRole("tabpanel");

describe("elements panel", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  beforeEach(() => {
    useStudioStore.getState().open(createDesign("Card", 300, 200));
  });

  afterEach(() => {
    cleanup();
    useStudioStore.getState().close();
  });

  it("opens another tab at the top instead of where the last one was scrolled", () => {
    render(<ElementsPanel />);
    panel().scrollTop = 600;

    fireEvent.click(screen.getByRole("tab", { name: "Layers" }));

    expect(panel().scrollTop).toBe(0);
    expect(panel().textContent).toBe("layers");
  });

  it("keeps the scroll position while the same tab is clicked again", () => {
    render(<ElementsPanel />);
    panel().scrollTop = 600;

    fireEvent.click(screen.getByRole("tab", { name: "Elements" }));

    expect(panel().scrollTop).toBe(600);
  });

  it("returns to the elements list at the top after visiting another tab", () => {
    render(<ElementsPanel />);
    panel().scrollTop = 600;

    fireEvent.click(screen.getByRole("tab", { name: "Templates" }));
    fireEvent.click(screen.getByRole("tab", { name: "Elements" }));

    expect(panel().scrollTop).toBe(0);
    expect(screen.getByRole("tab", { name: "Elements" }).getAttribute("aria-selected")).toBe("true");
  });
});
