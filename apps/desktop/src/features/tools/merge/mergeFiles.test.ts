import { describe, expect, it } from "vitest";
import { comparablePath, withoutListed } from "./mergeFiles";

describe("comparablePath", () => {
  it("ignores case, slash direction and doubled separators on Windows paths", () => {
    expect(comparablePath("C:\\Docs\\Report.PDF")).toBe(comparablePath("c:/docs//report.pdf"));
  });

  it("resolves dot segments and a trailing separator", () => {
    expect(comparablePath("C:\\Docs\\old\\..\\.\\a.pdf")).toBe("c:/docs/a.pdf");
    expect(comparablePath("/home/me/docs/")).toBe("/home/me/docs");
  });

  it("never climbs above the drive or the network share", () => {
    expect(comparablePath("C:\\..\\a.pdf")).toBe("c:/a.pdf");
    expect(comparablePath("\\\\Server\\Share\\..\\a.pdf")).toBe("//server/share/a.pdf");
  });

  it("keeps case on POSIX paths, where File.pdf and file.pdf are different files", () => {
    expect(comparablePath("/home/me/File.pdf")).not.toBe(comparablePath("/home/me/file.pdf"));
  });
});

describe("withoutListed", () => {
  it("keeps new files in order and counts the ones already listed", () => {
    expect(withoutListed(["C:\\in\\a.pdf"], ["c:/IN/A.pdf", "C:\\in\\b.pdf", "C:\\in\\c.pdf"])).toEqual({ fresh: ["C:\\in\\b.pdf", "C:\\in\\c.pdf"], repeated: 1 });
  });

  it("drops a file that appears twice in the same batch", () => {
    expect(withoutListed([], ["C:\\in\\a.pdf", "C:/in/A.PDF"])).toEqual({ fresh: ["C:\\in\\a.pdf"], repeated: 1 });
  });

  it("returns nothing new when every file is already in the list", () => {
    expect(withoutListed(["/srv/a.pdf", "/srv/b.pdf"], ["/srv/b.pdf", "/srv/./a.pdf"])).toEqual({ fresh: [], repeated: 2 });
  });
});
