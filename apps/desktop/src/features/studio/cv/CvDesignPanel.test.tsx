import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { CV_LAYOUT_IDS } from "./cvModel";
import { useCvStore } from "./cvStore";

const thumbnails = vi.hoisted(() => ({ ready: new Set<string>(), requested: [] as string[], listeners: new Set<() => void>(), version: 0 }));

vi.mock("../templates/thumbnails", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => {
    thumbnails.listeners.add(listener);
    return () => thumbnails.listeners.delete(listener);
  };
  return {
    useTemplateThumbnail: (id: string) => {
      useSyncExternalStore(subscribe, () => thumbnails.version);
      thumbnails.requested.push(id);
      return thumbnails.ready.has(id) ? { status: "ready", url: `blob:${id}` } : { status: "loading" };
    },
  };
});
vi.mock("@/components/shared/FontPicker", () => ({ FontPicker: () => null }));

function finishRequested() {
  act(() => {
    for (const id of new Set(thumbnails.requested)) thumbnails.ready.add(id);
    thumbnails.version += 1;
    for (const listener of thumbnails.listeners) listener();
  });
}

const { CvDesignPanel } = await import("./CvDesignPanel");

const card = (layout: string) => document.querySelector(`[data-cv-layout="${layout}"]`) as HTMLElement;
const picture = (layout: string) => card(layout).querySelector("img")?.getAttribute("src") ?? null;

describe("cv design panel", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  beforeEach(() => {
    thumbnails.ready.clear();
    thumbnails.requested = [];
    useCvStore.getState().open("en");
  });

  afterEach(() => {
    cleanup();
    useCvStore.getState().close();
  });

  it("shows every layout as a picture once its thumbnail is ready", () => {
    render(<CvDesignPanel />);

    finishRequested();

    expect(CV_LAYOUT_IDS.every((layout) => picture(layout)?.startsWith("blob:cv:"))).toBe(true);
  });

  it("keeps the old picture while the thumbnail for a new accent is being made", () => {
    render(<CvDesignPanel />);
    act(() => useCvStore.getState().updateTheme({ accent: "#0f766e" }));
    finishRequested();
    const before = picture("modern");

    act(() => useCvStore.getState().updateTheme({ accent: "#e11d48" }));

    expect(picture("modern")).toBe(before);
    expect(card("modern").querySelector("img")?.getAttribute("data-thumbnail-state")).toBe("loading");
  });

  it("switches the layout from its card", () => {
    render(<CvDesignPanel />);

    fireEvent.click(card("classic"));

    expect(useCvStore.getState().theme.layout).toBe("classic");
    expect(card("classic").getAttribute("aria-pressed")).toBe("true");
  });
});
