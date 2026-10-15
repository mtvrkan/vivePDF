import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";

const jumpTo = vi.fn();
const scrollToNextPage = vi.fn();
const scrollToPreviousPage = vi.fn();
let currentPage = 1;
let labels: string[] | null = null;

vi.mock("@embedpdf/plugin-scroll/react", () => ({
  useScroll: () => ({ state: { currentPage, totalPages: 278 }, provides: { scrollToNextPage, scrollToPreviousPage } }),
}));
vi.mock("./usePageNavigation", () => ({ usePageNavigation: () => ({ jumpTo }) }));
vi.mock("@/shared/store/pageLabelsStore", () => ({ usePageLabels: () => labels }));

const { PageNavigator } = await import("./PageNavigator");

const pageInput = () => screen.getByRole("textbox", { name: "Page number" }) as HTMLInputElement;

describe("PageNavigator", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  beforeEach(() => {
    currentPage = 1;
    labels = null;
    jumpTo.mockClear();
    scrollToNextPage.mockClear();
    scrollToPreviousPage.mockClear();
  });

  afterEach(cleanup);

  it("jumps to a typed page and shows the page count under the box", () => {
    render(<PageNavigator documentId="doc" />);

    fireEvent.change(pageInput(), { target: { value: "120" } });
    fireEvent.submit(pageInput().form as HTMLFormElement);

    expect(jumpTo).toHaveBeenCalledWith(120);
    expect(screen.getByRole("group", { name: "Page navigation" }).textContent).toContain("278");
  });

  it("disables the previous-page arrow on the first page and the next-page arrow on the last", () => {
    const first = render(<PageNavigator documentId="doc" />);
    expect((screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    first.unmount();
    currentPage = 278;

    render(<PageNavigator documentId="doc" />);

    expect(scrollToNextPage).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("puts the current page back when the typed value is not a page", () => {
    render(<PageNavigator documentId="doc" />);

    fireEvent.change(pageInput(), { target: { value: "abc" } });
    fireEvent.blur(pageInput());

    expect(jumpTo).not.toHaveBeenCalled();
    expect(pageInput().value).toBe("1");
  });

  it("shows the label in the box and only the page total below it when the document has page labels", () => {
    labels = Array.from({ length: 278 }, (_, index) => (index < 15 ? `p${index + 1}` : String(index - 14)));
    currentPage = 164;

    render(<PageNavigator documentId="doc" />);

    expect(pageInput().value).toBe("149");
    const position = screen.getByTestId("page-count");
    expect(position.textContent).toBe("278");
    expect(position.className).not.toContain("truncate");
    expect(position.getAttribute("title")).toBe("164 / 278");
  });
});
