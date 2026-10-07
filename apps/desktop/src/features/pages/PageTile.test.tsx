import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import type { OrganizerTile } from "@/types";

vi.mock("./PageThumbnail", () => ({ PageThumbnail: () => <span data-testid="thumbnail" /> }));

import { PageTile, type TileActions } from "./PageTile";

const TILE: OrganizerTile = { key: "p1", kind: "page", sourceId: "main", index: 1, rotate: 0 };

function actions(): TileActions {
  return { pointerDown: vi.fn(), click: vi.fn(), check: vi.fn(), preview: vi.fn(), rotate: vi.fn(), remove: vi.fn(), menu: vi.fn(), toggleCut: vi.fn() };
}

function renderTile(tileActions: TileActions, total = 3) {
  return render(
    <ol>
      <PageTile tile={TILE} position={0} total={total} isLast={total === 1} isSelected={false} isCut={false} dropBefore={false} dropAfter={false} dimmed={false} labelText={null} labelStart={false} sources={{}} width={120} height={156} actions={tileActions} />
    </ol>,
  );
}

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

afterEach(cleanup);

describe("PageTile", () => {
  it("selects on a click and previews only on a double click", () => {
    const tileActions = actions();
    renderTile(tileActions);
    const tile = screen.getByRole("option");

    fireEvent.click(tile);
    expect(tileActions.click).toHaveBeenCalledWith(expect.anything(), "p1");
    expect(tileActions.preview).not.toHaveBeenCalled();

    fireEvent.doubleClick(tile);
    expect(tileActions.preview).toHaveBeenCalledWith("p1");
  });

  it("rotates and deletes this page from its quick buttons without selecting it", () => {
    const tileActions = actions();
    renderTile(tileActions);

    fireEvent.click(screen.getByRole("button", { name: "Rotate page 1 left" }));
    fireEvent.click(screen.getByRole("button", { name: "Rotate page 1 right" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete page 1" }));

    expect(tileActions.rotate).toHaveBeenNthCalledWith(1, "p1", -90);
    expect(tileActions.rotate).toHaveBeenNthCalledWith(2, "p1", 90);
    expect(tileActions.remove).toHaveBeenCalledWith("p1");
    expect(tileActions.click).not.toHaveBeenCalled();
  });

  it("keeps the only page from being deleted", () => {
    const tileActions = actions();
    renderTile(tileActions, 1);

    const remove = screen.getByRole("button", { name: "Delete page 1" }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    fireEvent.click(remove);
    expect(tileActions.remove).not.toHaveBeenCalled();
  });
});
