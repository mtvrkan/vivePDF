import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ready, setLocale } from "@/app/i18n";
import { useToastStore } from "@/shared/store/toastStore";
import { CvForm } from "./CvForm";
import { emptyExperience, emptyProfile } from "./cvModel";
import { useCvStore } from "./cvStore";

const profile = () => useCvStore.getState().profile;
const section = (key: string) => document.querySelector(`[data-cv-section="${key}"]`) as HTMLElement;

describe("cv form", () => {
  beforeAll(async () => {
    await ready();
    await setLocale("en");
  });

  beforeEach(() => {
    localStorage.clear();
    useCvStore.setState({ loaded: false });
    useCvStore.getState().open("en");
    useCvStore.getState().replace({ profile: { ...emptyProfile(), experience: [{ ...emptyExperience(), role: "Designer", organisation: "Acme" }] }, theme: useCvStore.getState().theme });
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    cleanup();
    useCvStore.getState().close();
  });

  it("opens the filled section and the next empty one, and adds an entry from the header with its first field focused", () => {
    render(<CvForm />);
    expect(within(section("experience")).getByRole("button", { name: /^Experience/ }).getAttribute("aria-expanded")).toBe("true");
    expect(within(section("summary")).getByRole("button", { name: /^Profile/ }).getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(within(section("experience")).getByRole("button", { name: "Add experience" }));

    expect(profile().experience).toHaveLength(2);
    expect(document.activeElement).toBe(within(section("experience")).getAllByLabelText("Position")[1]);
  });

  it("duplicates an entry next to itself and brings a removed one back from the toast", () => {
    render(<CvForm />);
    fireEvent.click(within(section("experience")).getByRole("button", { name: "Duplicate Designer" }));
    expect(profile().experience.map((item) => item.role)).toEqual(["Designer", "Designer"]);

    fireEvent.click(within(section("experience")).getAllByRole("button", { name: "Remove Designer" })[0]);
    expect(profile().experience).toHaveLength(1);
    const toast = useToastStore.getState().toasts.at(-1);
    act(() => toast?.action?.onClick());

    expect(profile().experience).toHaveLength(2);
  });

  it("turns a pasted list into one skill per item", () => {
    render(<CvForm />);
    fireEvent.click(within(section("skills")).getByRole("button", { name: /^Skills/ }));
    fireEvent.click(within(section("skills")).getByRole("button", { name: "Add skill" }));
    const input = within(section("skills")).getByLabelText("Skill");

    fireEvent.paste(input, { clipboardData: { getData: () => "Figma, Sketch\nExcel" } });

    expect(profile().skills.map((item) => item.name)).toEqual(["Figma", "Sketch", "Excel"]);
  });

  it("writes a picked month and year in the CV language", () => {
    render(<CvForm />);
    const card = within(section("experience"));

    fireEvent.change(card.getByLabelText("Start year"), { target: { value: "2021" } });

    expect(profile().experience[0].start).toBe("2021");
  });

  it("follows the section order chosen in the design tab", () => {
    act(() => useCvStore.getState().updateProfile((current) => ({ ...current, order: ["skills", ...current.order.filter((key) => key !== "skills")] })));

    render(<CvForm />);

    const order = [...document.querySelectorAll("[data-cv-section]")].map((node) => node.getAttribute("data-cv-section"));
    expect(order.slice(0, 3)).toEqual(["personal", "skills", "summary"]);
  });
});
