import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RpcCallError } from "@/shared/rpc/client";
import { translateDownload, translateModels, translateText } from "@/shared/rpc/operations";
import { useTranslateModelsStore } from "@/shared/store/translateModelsStore";
import { useTranslationStore } from "@/shared/store/translationStore";
import { axeViolations } from "@/test/axe";
import type { TranslateModel } from "@/types";

const models: TranslateModel[] = [
  { id: "de_en", source: "de", target: "en", version: "1.3", sizeMb: 92, installed: true, origin: "catalog" },
  { id: "en_de", source: "en", target: "de", version: "1.3", sizeMb: 91, installed: true, origin: "catalog" },
  { id: "en_tr", source: "en", target: "tr", version: "2.0", sizeMb: 225, installed: false, origin: "catalog" },
  { id: "tr_en", source: "tr", target: "en", version: "2.0", sizeMb: 226, installed: false, origin: "catalog" },
  { id: "en_fr", source: "en", target: "fr", version: "1.9", sizeMb: 80, installed: false, origin: "catalog" },
  { id: "fr_en", source: "fr", target: "en", version: "1.9", sizeMb: 81, installed: false, origin: "catalog" },
];

vi.mock("@/shared/rpc/operations", () => ({
  translateModels: vi.fn(async () => ({ directory: "C:/translate", models })),
  translateDownload: vi.fn(async (id: string) => ({ id, installed: [id] })),
  translateRemove: vi.fn(),
  translateText: vi.fn(),
}));

const { TranslatePanel } = await import("./TranslatePanel");

function renderPanel() {
  return render(
    <MemoryRouter>
      <TranslatePanel />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(translateText).mockReset();
  vi.mocked(translateDownload).mockClear();
  vi.mocked(translateModels).mockClear();
  useTranslateModelsStore.setState({ models, directory: "C:/translate", loading: false, loaded: true, error: null, downloadingLanguage: null, downloadProgress: null });
  useTranslationStore.setState({ text: "", truncated: false, status: "idle", progress: null, result: null, error: null, source: "de", target: "tr" });
});

afterEach(cleanup);

describe("TranslatePanel", () => {
  it("explains how to start when nothing is selected", async () => {
    const { container } = renderPanel();
    expect(screen.getByText("Nothing to translate yet")).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("sends people to settings when no model is installed", () => {
    useTranslateModelsStore.setState({ models: models.map((model) => ({ ...model, installed: false })) });
    useTranslationStore.setState({ text: "Hallo" });
    renderPanel();
    expect(screen.getByText("No translation languages installed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Install languages" })).toBeTruthy();
  });

  it("shows a routed result with a copy action", async () => {
    useTranslationStore.setState({ text: "Hallo Welt", status: "done", result: { text: "Merhaba dünya", source: "de", target: "tr", route: ["de_en", "en_tr"] } });
    const { container } = renderPanel();
    expect(screen.getByText("Merhaba dünya").getAttribute("lang")).toBe("tr");
    expect(screen.getByText("Via English")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy translation" })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("offers the missing language pack inline and translates once it is installed", async () => {
    vi.mocked(translateText).mockResolvedValueOnce({ text: "Merhaba", source: "de", target: "tr", route: ["de_en", "en_tr"] });
    vi.mocked(translateModels).mockResolvedValue({ directory: "C:/translate", models: models.map((model) => ({ ...model, installed: model.target !== "fr" && model.source !== "fr" })) });
    useTranslationStore.setState({
      text: "Hallo",
      status: "error",
      error: { code: "UNSUPPORTED", message: "missing", data: { reason: "translationPairMissing", missing: ["en_tr"] } },
    });
    renderPanel();
    expect(screen.getByText("A language this translation needs is not installed. Download it below.")).toBeTruthy();
    expect(screen.getByText("Turkish language pack")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download · 451 MB" }));
    });
    expect(vi.mocked(translateDownload).mock.calls.map(([id]) => id)).toEqual(["tr_en", "en_tr"]);
    expect(translateText).toHaveBeenCalledWith({ text: "Hallo", source: "de", target: "tr" }, expect.anything());
    expect(await screen.findByText("Merhaba")).toBeTruthy();
  });

  it("offers to translate again after a cancelled run", async () => {
    vi.mocked(translateText).mockRejectedValueOnce(new RpcCallError({ code: "CANCELLED", message: "operation cancelled" }));
    useTranslationStore.setState({ text: "Hallo" });
    renderPanel();
    await act(async () => {
      await useTranslationStore.getState().run();
    });
    expect(useTranslationStore.getState().status).toBe("idle");
    expect(screen.getByRole("button", { name: "Translate" })).toBeTruthy();
  });

  it("lists ready languages first in the language pickers", async () => {
    Element.prototype.scrollIntoView = () => undefined;
    useTranslationStore.setState({ text: "Hallo" });
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole("combobox", { name: "From" }));
    });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["English", "German", "French", "Turkish"]);
  });
});
