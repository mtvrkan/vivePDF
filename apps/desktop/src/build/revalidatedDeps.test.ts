import { describe, expect, it } from "vitest";
import { devCacheControl } from "./revalidatedDeps";

describe("devCacheControl", () => {
  it("makes the webview revalidate pre-bundled dependencies", () => {
    expect(devCacheControl("/node_modules/.vite/deps/react-dom_client.js?v=50cf9bee", "Cache-Control", "max-age=31536000,immutable")).toBe("no-cache");
  });

  it("leaves other headers of pre-bundled dependencies alone", () => {
    expect(devCacheControl("/node_modules/.vite/deps/react.js?v=50cf9bee", "Content-Type", "text/javascript")).toBe("text/javascript");
  });

  it("leaves caching of app sources and unknown requests alone", () => {
    expect(devCacheControl("/src/main.tsx", "Cache-Control", "no-cache")).toBe("no-cache");
    expect(devCacheControl(undefined, "Cache-Control", "max-age=60")).toBe("max-age=60");
  });
});
