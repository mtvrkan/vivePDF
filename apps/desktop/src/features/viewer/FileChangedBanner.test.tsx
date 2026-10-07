import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { axeViolations } from "@/test/axe";
import { FileChangedBanner } from "./FileChangedBanner";

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

afterEach(cleanup);

function renderBanner(status: "missing" | "conflict" | "changed") {
  const handlers = { onReload: vi.fn(), onDismiss: vi.fn(), onSaveCopy: vi.fn() };
  const view = render(<FileChangedBanner status={status} fileName="thesis.pdf" {...handlers} />);
  return { ...view, ...handlers };
}

describe("FileChangedBanner", () => {
  it("offers a reload when the file changed and the preference is off", () => {
    const { onReload } = renderBanner("changed");

    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    expect(screen.getByRole("status").textContent).toContain("thesis.pdf changed on disk.");
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("lets a conflict keep the local changes", () => {
    const { onDismiss, onReload } = renderBanner("conflict");

    fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onReload).not.toHaveBeenCalled();
  });

  it("offers a copy instead of a reload when the file is gone", () => {
    const { onSaveCopy } = renderBanner("missing");

    fireEvent.click(screen.getByRole("button", { name: "Save a copy…" }));

    expect(onSaveCopy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderBanner("conflict");

    const violations = await axeViolations(container);

    expect(violations).toEqual([]);
  });
});
