import { describe, expect, it } from "vitest";
import { CONTRIBUTORS, mergeContributors, parseContributors, THANKS, type Contributor } from "./credits";

describe("parseContributors", () => {
  it("parses a valid array of contributor objects", () => {
    const raw = [
      { login: "mtvrkan", html_url: "https://github.com/mtvrkan", avatar_url: "https://avatars.githubusercontent.com/u/1", contributions: 42 },
    ];
    expect(parseContributors(raw)).toEqual([
      { login: "mtvrkan", htmlUrl: "https://github.com/mtvrkan", avatarUrl: "https://avatars.githubusercontent.com/u/1", contributions: 42 },
    ]);
  });

  it("skips malformed entries while keeping valid ones", () => {
    const raw = [
      { login: "valid", html_url: "https://github.com/valid", avatar_url: "https://x/y", contributions: 3 },
      { login: 123, html_url: "https://x", avatar_url: "https://x", contributions: 1 },
      null,
      "not-an-object",
      { login: "missing-fields" },
    ];
    expect(parseContributors(raw)).toEqual([
      { login: "valid", htmlUrl: "https://github.com/valid", avatarUrl: "https://x/y", contributions: 3 },
    ]);
  });

  it("returns an empty array for non-array input", () => {
    expect(parseContributors(null)).toEqual([]);
    expect(parseContributors(undefined)).toEqual([]);
    expect(parseContributors({ login: "x" })).toEqual([]);
    expect(parseContributors("string")).toEqual([]);
  });
});

describe("mergeContributors", () => {
  const curated: Contributor[] = [
    {
      login: "mtvrkan",
      name: "Mehmet Türkan",
      roleKey: "about.credits.roles.founder",
      htmlUrl: "https://github.com/mtvrkan",
      avatarUrl: "https://github.com/mtvrkan.png",
      contributions: null,
    },
  ];

  it("keeps curated entries first and dedupes case-insensitively against fetched entries", () => {
    const fetched = [
      { login: "MTVRKAN", htmlUrl: "https://github.com/mtvrkan", avatarUrl: "https://avatars.githubusercontent.com/u/1", contributions: 10 },
      { login: "someone", htmlUrl: "https://github.com/someone", avatarUrl: "https://avatars.githubusercontent.com/u/2", contributions: 5 },
    ];
    const result = mergeContributors(curated, fetched);
    expect(result.map((entry) => entry.login)).toEqual(["mtvrkan", "someone"]);
  });

  it("fills contributions and a missing avatar for curated entries while keeping a bundled avatar", () => {
    const fetched = [
      { login: "mtvrkan", htmlUrl: "https://github.com/mtvrkan", avatarUrl: "https://avatars.githubusercontent.com/u/1", contributions: 10 },
    ];
    const result = mergeContributors(curated, fetched);
    expect(result[0].contributions).toBe(10);
    expect(result[0].avatarUrl).toBe(curated[0].avatarUrl);
    const withoutAvatar = mergeContributors([{ ...curated[0], avatarUrl: null }], fetched);
    expect(withoutAvatar[0].avatarUrl).toBe("https://avatars.githubusercontent.com/u/1");
  });

  it("keeps the curated list unchanged when fetched is empty", () => {
    expect(mergeContributors(curated, [])).toEqual(curated);
  });
});

describe("THANKS", () => {
  it("bundles every avatar so the tab makes no network request before Refresh", () => {
    for (const person of THANKS) {
      expect(person.avatarUrl).not.toBeNull();
      expect(person.avatarUrl).not.toMatch(/^https?:/);
    }
  });

  it("keeps thanked people out of the contributor list and unique by login", () => {
    const logins = THANKS.map((person) => person.login.toLowerCase());
    expect(new Set(logins).size).toBe(logins.length);
    const contributorLogins = new Set(CONTRIBUTORS.map((entry) => entry.login.toLowerCase()));
    expect(logins.some((login) => contributorLogins.has(login))).toBe(false);
  });
});
