import { afterEach, describe, expect, it } from "vitest";
import { usePreferencesStore } from "@/shared/store/preferencesStore";
import { useUiStore } from "@/shared/store/uiStore";
import { preferredOcrLanguages } from "./ocrLanguages";

const preferences = usePreferencesStore.getState();
const ui = useUiStore.getState();

afterEach(() => {
  usePreferencesStore.setState({ ocrLanguage: preferences.ocrLanguage });
  useUiStore.setState({ locale: ui.locale });
});

describe("preferredOcrLanguages", () => {
  it("uses the languages chosen in settings in their order", () => {
    usePreferencesStore.setState({ ocrLanguage: " deu+eng , fra " });
    expect(preferredOcrLanguages()).toEqual(["deu", "eng", "fra"]);
  });

  it("reads English alone for an English interface when nothing is chosen", () => {
    usePreferencesStore.setState({ ocrLanguage: "" });
    useUiStore.setState({ locale: "en" });
    expect(preferredOcrLanguages()).toEqual(["eng"]);
  });

  it("adds English after the interface language when nothing is chosen", () => {
    usePreferencesStore.setState({ ocrLanguage: "   " });
    useUiStore.setState({ locale: "tr" });
    expect(preferredOcrLanguages()).toEqual(["tur", "eng"]);
  });
});
