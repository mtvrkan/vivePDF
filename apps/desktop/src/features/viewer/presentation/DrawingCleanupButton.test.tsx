import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { DrawingCleanupButton } from "./DrawingCleanupButton";

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

afterEach(cleanup);

describe("DrawingCleanupButton", () => {
  it("offers clearing the page and everything with their counts", () => {
    const onClearPage = vi.fn();
    const onClearAll = vi.fn();
    render(<DrawingCleanupButton pageCount={2} totalCount={5} onClearPage={onClearPage} onClearAll={onClearAll} />);

    fireEvent.click(screen.getByTestId("presentation-cleanup"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Clear this page \(2\)/ }));

    expect(onClearPage).toHaveBeenCalledTimes(1);
    expect(onClearAll).not.toHaveBeenCalled();
  });

  it("disables clearing the page when only other pages have drawings", () => {
    render(<DrawingCleanupButton pageCount={0} totalCount={3} onClearPage={vi.fn()} onClearAll={vi.fn()} />);

    fireEvent.click(screen.getByTestId("presentation-cleanup"));

    expect((screen.getByRole("menuitem", { name: /Clear this page/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("menuitem", { name: /Clear all drawings \(3\)/ })).toBeTruthy();
  });

  it("is disabled while nothing is drawn", () => {
    render(<DrawingCleanupButton pageCount={0} totalCount={0} onClearPage={vi.fn()} onClearAll={vi.fn()} />);

    expect((screen.getByTestId("presentation-cleanup") as HTMLButtonElement).disabled).toBe(true);
  });
});
