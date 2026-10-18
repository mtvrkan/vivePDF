import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PageSkeleton } from "./PageSkeleton";

afterEach(cleanup);

function page(children?: React.ReactNode) {
  return render(
    <div data-testid="page">
      <PageSkeleton />
      {children}
    </div>,
  );
}

describe("PageSkeleton", () => {
  it("shows a placeholder until the page's picture arrives, then stops watching the page", async () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    const { getByTestId, container } = page();
    expect(container.querySelector(".page-skeleton")).not.toBeNull();

    await act(async () => {
      getByTestId("page").appendChild(document.createElement("img"));
      await Promise.resolve();
    });

    expect(container.querySelector(".page-skeleton")).toBeNull();
    expect(disconnect).toHaveBeenCalled();
    disconnect.mockRestore();
  });

  it("never shows a placeholder over a page that is already drawn", () => {
    const { container } = page(<canvas />);

    expect(container.querySelector(".page-skeleton")).toBeNull();
  });

  it("keeps the placeholder while only other layers are added", async () => {
    const { getByTestId, container } = page();

    await act(async () => {
      getByTestId("page").appendChild(document.createElement("div"));
      await Promise.resolve();
    });

    expect(container.querySelector(".page-skeleton")).not.toBeNull();
  });
});
