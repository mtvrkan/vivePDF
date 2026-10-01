import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { axeViolations } from "@/test/axe";
import { PasswordBreachAlert } from "./PasswordBreachNote";

const QUIET = { checking: false, breached: false, variant: false, count: null, onlineUnavailable: false };

afterEach(() => cleanup());

describe("PasswordBreachAlert", () => {
  it("keeps an empty live region while the password is not known to be breached", () => {
    const { container } = render(<PasswordBreachAlert state={QUIET} />);
    const region = container.querySelector("[role='status']");
    expect(region).not.toBeNull();
    expect(region?.textContent).toBe("");
  });

  it("warns with the count when the online check found it", async () => {
    const { container } = render(<PasswordBreachAlert state={{ ...QUIET, breached: true, count: 52372427 }} />);
    expect(container.textContent).toContain("52,372,427 times");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("warns from the built-in list and notes when the online check was unavailable", () => {
    const { container } = render(<PasswordBreachAlert state={{ ...QUIET, breached: true, onlineUnavailable: true }} />);
    expect(container.textContent).toContain("most common breached passwords");
    expect(container.textContent).toContain("online breach check is unavailable");
  });

  it("says a variant is a changed common password rather than a breached one", () => {
    const { container } = render(<PasswordBreachAlert state={{ ...QUIET, breached: true, variant: true, count: 0 }} />);
    expect(container.textContent).toContain("with small changes");
    expect(container.textContent).not.toContain("times");
  });
});
