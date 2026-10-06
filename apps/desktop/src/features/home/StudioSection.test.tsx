import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useRecentDesignsStore, type RecentDesign } from "@/features/studio/design/recentDesigns";
import { axeViolations } from "@/test/axe";
import { StudioSection } from "./StudioSection";

const design = (name: string): RecentDesign => ({ path: `C:/Designs/${name}.vivedesign`, name, savedAt: Date.now(), width: 595, height: 842, thumbnail: "" });

function StudioProbe() {
  const location = useLocation();
  return <p data-testid="studio-route">{`${location.pathname}${location.search} ${JSON.stringify(location.state)}`}</p>;
}

function renderSection(size?: "small" | "medium" | "large") {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<StudioSection size={size} />} />
        <Route path="/studio" element={<StudioProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

beforeEach(() => {
  useRecentDesignsStore.setState({ items: [] });
});

afterEach(cleanup);

describe("StudioSection", () => {
  it("opens a recent design in Studio by handing its path over", () => {
    useRecentDesignsStore.setState({ items: [design("Poster"), design("Invoice")] });
    renderSection();

    fireEvent.click(screen.getByRole("button", { name: /Invoice/ }));

    expect(screen.getByTestId("studio-route").textContent).toBe('/studio {"designPath":"C:/Designs/Invoice.vivedesign"}');
  });

  it("explains the empty list, passes an accessibility check and still starts Studio and the CV builder", async () => {
    const { container } = renderSection();

    expect(screen.getByText("Designs and documents you save in Studio appear here.")).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Open CV builder" }));
    expect(screen.getByTestId("studio-route").textContent).toBe("/studio?cv=1 null");
  });

  it("shows only as many designs as the section size allows", () => {
    useRecentDesignsStore.setState({ items: Array.from({ length: 10 }, (_, index) => design(`Design ${index}`)) });
    renderSection("small");

    expect(document.querySelectorAll("[data-home-design]")).toHaveLength(3);
  });
});
