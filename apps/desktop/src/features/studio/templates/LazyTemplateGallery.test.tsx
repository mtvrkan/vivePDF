import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StudioTemplate } from "./kit";

let release: () => void = () => undefined;
const loaded = new Promise<void>((resolve) => {
  release = resolve;
});

vi.mock("./TemplateGallery", async () => {
  await loaded;
  return {
    TemplateGallery: ({ language, box, onPick }: { language: string; box: number; onPick: (template: StudioTemplate) => void }) => (
      <button type="button" onClick={() => onPick({ id: "invoice" } as StudioTemplate)}>
        {`gallery ${language} ${box}`}
      </button>
    ),
  };
});

const { LazyTemplateGallery } = await import("./LazyTemplateGallery");

describe("LazyTemplateGallery", () => {
  it("shows placeholders of the requested size until the gallery arrives, then passes every prop on", async () => {
    const onPick = vi.fn();
    const { container } = render(<LazyTemplateGallery language="tr" box={104} onPick={onPick} className="p-3" />);

    const skeleton = container.querySelector("[aria-busy]") as HTMLElement;
    expect(skeleton.className).toBe("p-3");
    expect((skeleton.querySelector(".rounded-md") as HTMLElement).style.width).toBe("104px");

    release();
    (await screen.findByRole("button", { name: "gallery tr 104" })).click();

    expect(onPick).toHaveBeenCalledWith({ id: "invoice" });
    expect(container.querySelector("[aria-busy]")).toBeNull();
  });
});
