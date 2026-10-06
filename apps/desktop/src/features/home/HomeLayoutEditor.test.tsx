import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { axeViolations } from "@/test/axe";
import { HiddenSectionFrame, HomeEditBar } from "./HomeLayoutEditor";
import { defaultHomeLayout, updateSection } from "./homeLayout";
import { useHomeLayoutStore } from "./homeLayoutStore";

const sectionIds = () => useHomeLayoutStore.getState().layout.sections.map((section) => section.id);

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  useHomeLayoutStore.setState({ layout: updateSection(defaultHomeLayout(), "history", { hidden: true }), editing: true });
});

afterEach(cleanup);

describe("HiddenSectionFrame", () => {
  it("shows a hidden section again in the place it was hidden", async () => {
    const section = useHomeLayoutStore.getState().layout.sections.find((item) => item.id === "history");
    const before = sectionIds();
    const { container } = render(<HiddenSectionFrame section={section!} />);
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Show Recent operations" }));

    const history = useHomeLayoutStore.getState().layout.sections.find((item) => item.id === "history");
    expect(history).toMatchObject({ region: "side", hidden: false });
    expect(sectionIds()).toEqual(before);
  });
});

describe("HomeEditBar", () => {
  it("finishes editing from the bar and no longer lists hidden sections there", () => {
    render(<HomeEditBar />);

    expect(screen.queryByRole("button", { name: "Recent operations" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(useHomeLayoutStore.getState().editing).toBe(false);
  });

  it("resets the layout, which shows hidden sections again", () => {
    render(<HomeEditBar />);

    fireEvent.click(screen.getByRole("button", { name: /Reset/ }));

    expect(useHomeLayoutStore.getState().layout.sections.every((section) => !section.hidden)).toBe(true);
  });
});
