import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addItems, duplicateItem, moveItem, removeItem, restoreItem } from "./cvEdits";
import { safeFileName } from "./cvFiles";
import { cvId, CV_LIMITS, emptyProfile } from "./cvModel";
import { useCvStore } from "./cvStore";

const skills = () => useCvStore.getState().profile.skills.map((item) => item.name);
const skill = (name: string) => ({ id: cvId(), name, level: 3 });

describe("cv list edits", () => {
  beforeEach(() => {
    localStorage.clear();
    useCvStore.setState({ loaded: false });
    useCvStore.getState().open("en");
    useCvStore.getState().replace({ profile: { ...emptyProfile(), skills: [skill("A"), skill("B"), skill("C")] }, theme: useCvStore.getState().theme });
  });

  afterEach(() => useCvStore.getState().close());

  it("adds after a given item, duplicates next to the source and moves within bounds", () => {
    const [first] = useCvStore.getState().profile.skills;

    addItems("skills", [skill("New")], first.id, false);
    duplicateItem("skills", first.id);
    moveItem("skills", 0, 4);

    expect(skills()).toEqual(["A", "New", "B", "C", "A"]);
  });

  it("stops adding at the section limit and ignores moves outside the list", () => {
    const room = CV_LIMITS.skills - 3;

    const added = addItems("skills", Array.from({ length: room + 5 }, (_, index) => skill(`S${index}`)), undefined, false);
    moveItem("skills", -1, 2);
    moveItem("skills", 1, 999);

    expect(added).not.toBeNull();
    expect(skills()).toHaveLength(CV_LIMITS.skills);
    expect(skills().slice(0, 3)).toEqual(["A", "B", "C"]);
    expect(addItems("skills", [skill("Late")], undefined, false)).toBeNull();
  });

  it("puts a removed item back where it was once and never twice", () => {
    const target = useCvStore.getState().profile.skills[1];

    const removed = removeItem("skills", target.id);
    if (!removed) throw new Error("not removed");
    restoreItem("skills", removed.item, removed.index);
    restoreItem("skills", removed.item, removed.index);

    expect(skills()).toEqual(["A", "B", "C"]);
    expect(removeItem("skills", "missing")).toBeNull();
  });
});

describe("cv file names", () => {
  it("keeps a readable name without characters Windows refuses", () => {
    expect(safeFileName('Ada: "CV" <2026>?')).toBe("Ada CV 2026");
    expect(safeFileName("   ")).toBe("CV");
    expect(safeFileName("Name...")).toBe("Name");
    expect(safeFileName("x".repeat(120))).toHaveLength(80);
  });

  it("never uses a reserved device name", () => {
    expect(safeFileName("CON")).toBe("CV CON");
    expect(safeFileName("lpt1")).toBe("CV lpt1");
    expect(safeFileName("Conrad")).toBe("Conrad");
  });
});
