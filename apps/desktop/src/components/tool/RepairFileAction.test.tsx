import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { useLaunchStore } from "@/shared/store/launchStore";
import type { RpcError } from "@/types";
import { RepairFileAction } from "./RepairFileAction";

const damaged: RpcError = { code: "INVALID_PDF", message: "document is damaged" };

function renderAction(error: RpcError | null, path: string | undefined, className?: string) {
  return render(
    <MemoryRouter initialEntries={["/tools/compress"]}>
      <RepairFileAction error={error} path={path} className={className} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  useLaunchStore.getState().setPending(null);
});

describe("RepairFileAction", () => {
  it("offers Repair inside the given wrapper when a tool reports the file as damaged", () => {
    const { container } = renderAction(damaged, "C:/notes.pdf", "flex justify-center pb-6");

    const wrapper = container.firstElementChild?.className;
    fireEvent.click(screen.getByRole("button", { name: "tools.edit.repair.repairFile" }));

    expect(wrapper).toBe("flex justify-center pb-6");
    expect(useLaunchStore.getState().pendingPath).toBe("C:/notes.pdf");
  });

  it("renders the bare button when no wrapper is asked for", () => {
    const { container } = renderAction(damaged, "C:/notes.pdf");

    expect(container.firstElementChild?.tagName).toBe("BUTTON");
  });

  it("renders nothing, not even the wrapper, for an error Repair cannot help with", () => {
    const { container } = renderAction({ code: "NEEDS_PASSWORD", message: "locked" }, "C:/notes.pdf", "flex justify-center pb-6");

    expect(container.childElementCount).toBe(0);
  });
});
