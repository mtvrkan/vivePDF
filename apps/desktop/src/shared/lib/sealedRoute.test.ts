import { describe, expect, it } from "vitest";
import { sealedFileRoute, sealedOpenRoute } from "./sealedRoute";

describe("sealedFileRoute", () => {
  it("routes a sealed file to Open with a certificate with its path", () => {
    const route = sealedFileRoute({ code: "CERTIFICATE_SEALED", message: "sealed", data: { path: "C:\\Belgeler\\gizli ş.pdf" } });
    expect(route).not.toBeNull();
    const url = new URL(route ?? "", "http://app");
    expect(url.pathname).toBe("/tools/security");
    expect(url.searchParams.get("tab")).toBe("decryptCertificate");
    expect(url.searchParams.get("sealed")).toBe("C:\\Belgeler\\gizli ş.pdf");
  });

  it("falls back to the path the tool knows about", () => {
    const route = sealedFileRoute({ code: "CERTIFICATE_SEALED", message: "sealed" }, "/tmp/a.pdf");
    expect(new URL(route ?? "", "http://app").searchParams.get("sealed")).toBe("/tmp/a.pdf");
  });

  it("offers nothing for other errors", () => {
    expect(sealedFileRoute({ code: "NEEDS_PASSWORD", message: "pw" })).toBeNull();
    expect(sealedFileRoute(null)).toBeNull();
  });
});

describe("sealedOpenRoute", () => {
  it("offers the route when the file the viewer could not open is sealed", async () => {
    const route = await sealedOpenRoute("C:/Belgeler/gizli ş.pdf", () => Promise.reject(Object.assign(new Error("sealed"), { code: "CERTIFICATE_SEALED", data: { path: "C:/Belgeler/gizli ş.pdf" } })));
    expect(new URL(route ?? "", "http://app").searchParams.get("sealed")).toBe("C:/Belgeler/gizli ş.pdf");
  });

  it("stays out of the way for password files, damaged files and files that open", async () => {
    expect(await sealedOpenRoute("a.pdf", () => Promise.reject({ code: "NEEDS_PASSWORD", message: "pw" }))).toBeNull();
    expect(await sealedOpenRoute("a.pdf", () => Promise.reject(new Error("broken")))).toBeNull();
    expect(await sealedOpenRoute("a.pdf", () => Promise.resolve({ pageCount: 1 }))).toBeNull();
  });
});
