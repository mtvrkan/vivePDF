import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ready, setLocale } from "@/app/i18n";

const restoreSession = vi.fn();

vi.mock("@/shared/session/sessionStore", () => ({
  readSession: () => true,
  readStartupSession: () => ({ documents: ["C:/Docs/a.pdf"] }),
  writeSession: vi.fn(),
}));
vi.mock("@/shared/session/useRestoreSession", () => ({ useRestoreSession: () => restoreSession }));

const { ContinueStrip } = await import("./ContinueStrip");

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

afterEach(cleanup);

describe("ContinueStrip", () => {
  it("runs a single restore however often the button is pressed while it is pending", async () => {
    let finish: (ok: boolean) => void = () => undefined;
    restoreSession.mockReturnValue(new Promise<boolean>((resolve) => (finish = resolve)));
    render(<ContinueStrip />);
    const button = screen.getByRole("button", { name: "Restore session" });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(restoreSession).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => finish(false));
    expect((screen.getByRole("button", { name: "Restore session" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
