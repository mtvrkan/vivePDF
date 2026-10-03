import { beforeEach, describe, expect, it } from "vitest";
import { GROUP_COLORS, groupAfterMove, groupedOrder, isGroupColor, nextColor, savedGroups, useTabGroupStore } from "./tabGroups";

beforeEach(() => {
  useTabGroupStore.setState({ groups: [], memberOf: {} });
});

describe("groupedOrder", () => {
  it("pulls every member of a group next to the first one and keeps loose tabs in place", () => {
    expect(groupedOrder(["a", "x", "b", "y", "c"], { a: "g", c: "g" })).toEqual(["a", "c", "x", "b", "y"]);
  });

  it("leaves an order without groups untouched", () => {
    expect(groupedOrder(["a", "b"], {})).toEqual(["a", "b"]);
  });
});

describe("groupAfterMove", () => {
  it("joins the group a tab is dropped into the middle of", () => {
    expect(groupAfterMove(["a", "m", "b"], "m", { a: "g", b: "g" })).toBe("g");
  });

  it("keeps the group while the tab still touches one of its members", () => {
    expect(groupAfterMove(["x", "m", "a"], "m", { m: "g", a: "g" })).toBe("g");
  });

  it("leaves the group when the tab is dropped away from its members", () => {
    expect(groupAfterMove(["a", "x", "m"], "m", { a: "g", m: "g" })).toBeNull();
  });
});

describe("useTabGroupStore", () => {
  it("creates a coloured, unnamed group and drops a group once its last tab leaves", () => {
    const id = useTabGroupStore.getState().create(["a"]);
    expect(useTabGroupStore.getState().groups).toEqual([{ id, name: "", color: GROUP_COLORS[0], collapsed: false }]);
    useTabGroupStore.getState().leave("a");
    expect(useTabGroupStore.getState().groups).toEqual([]);
  });

  it("moves a tab between groups, renames within 40 characters and ungroups without closing", () => {
    const first = useTabGroupStore.getState().create(["a", "b"]);
    const second = useTabGroupStore.getState().create(["c"]);
    useTabGroupStore.getState().join("b", second);
    useTabGroupStore.getState().rename(first, `  ${"x".repeat(60)}  `);
    expect(useTabGroupStore.getState().memberOf).toEqual({ a: first, b: second, c: second });
    expect(useTabGroupStore.getState().groups.find((group) => group.id === first)?.name).toHaveLength(40);
    useTabGroupStore.getState().ungroup(second);
    expect(useTabGroupStore.getState().memberOf).toEqual({ a: first });
  });

  it("ignores joining a group that does not exist", () => {
    useTabGroupStore.getState().join("a", "missing");
    expect(useTabGroupStore.getState().memberOf).toEqual({});
  });

  it("saves groups by file path in tab order and restores them onto reopened documents", () => {
    const id = useTabGroupStore.getState().create(["b", "a"]);
    useTabGroupStore.getState().rename(id, "Contracts");
    useTabGroupStore.getState().setCollapsed(id, true);
    const paths: Record<string, string> = { a: "C:/a.pdf", b: "C:/b.pdf" };
    const saved = savedGroups(["a", "b", "c"], (doc) => paths[doc]);
    expect(saved).toEqual([{ name: "Contracts", color: GROUP_COLORS[0], collapsed: true, paths: ["C:/a.pdf", "C:/b.pdf"] }]);
    useTabGroupStore.getState().restore([{ name: "Contracts", color: "red", collapsed: true, documentIds: ["n1", "n2"] }, { name: "Empty", color: "blue", collapsed: false, documentIds: [] }]);
    const restored = useTabGroupStore.getState();
    expect(restored.groups).toHaveLength(1);
    expect(restored.groups[0]).toMatchObject({ name: "Contracts", color: "red", collapsed: true });
    expect(restored.memberOf).toEqual({ n1: restored.groups[0].id, n2: restored.groups[0].id });
  });
});

describe("group colours", () => {
  it("picks the first colour no group uses yet and recognises only known colours", () => {
    expect(nextColor([{ id: "g", name: "", color: "blue", collapsed: false }])).toBe("green");
    expect(isGroupColor("purple")).toBe(true);
    expect(isGroupColor("#ff0000")).toBe(false);
  });
});
