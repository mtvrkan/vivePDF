import { afterEach, beforeAll, describe, expect, it } from "vitest";
import i18n, { ready, setLocale } from "@/app/i18n";
import { toolShortcuts } from "@/app/navigation";
import { useCvStore } from "./cv/cvStore";
import { useStudioStore } from "./design/studioStore";
import { useDocumentStore } from "./document/documentStore";
import { createDesign } from "./model/design";
import { launchStudioStart, studioStartOf, withoutStudioStart } from "./startLink";

beforeAll(async () => {
  await ready();
  await setLocale("en");
});

afterEach(() => {
  useStudioStore.getState().close();
  useDocumentStore.getState().close();
  useCvStore.getState().close();
});

describe("studioStartOf", () => {
  it("reads every Studio link the tool grid uses", () => {
    const starts = toolShortcuts.filter((tool) => tool.route.startsWith("/studio?")).map((tool) => studioStartOf(new URLSearchParams(tool.route.split("?")[1])));

    expect(starts).toEqual(["document", "cv", "card", "sources"]);
  });

  it("ignores unknown starts and drops only its own parameters", () => {
    const params = new URLSearchParams("start=rocket&keep=1&cv=0");

    expect(studioStartOf(params)).toBeNull();
    expect(withoutStudioStart(new URLSearchParams("start=card&cv=1&keep=1")).toString()).toBe("keep=1");
  });
});

describe("launchStudioStart", () => {
  it("opens a two-sided business card", () => {
    launchStudioStart("card", i18n.t, "en");

    expect(useStudioStore.getState().design?.pages.map((page) => page.name)).toEqual(["Front", "Back"]);
  });

  it("opens a blank document with the sources dialog requested", () => {
    launchStudioStart("sources", i18n.t, "en");

    expect(useDocumentStore.getState().document).not.toBeNull();
    expect(useDocumentStore.getState().sourcesRequested).toBe(true);
  });

  it("keeps a design that is already open instead of replacing it", () => {
    const design = createDesign("Poster", 595, 842);
    useStudioStore.getState().open(design);

    launchStudioStart("document", i18n.t, "en");
    launchStudioStart("card", i18n.t, "en");

    expect(useStudioStore.getState().design?.name).toBe("Poster");
    expect(useDocumentStore.getState().document).toBeNull();
  });
});
