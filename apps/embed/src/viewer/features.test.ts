import { describe, expect, it } from "vitest";
import { parseSwitch } from "./features";

describe("parseSwitch", () => {
  it("keeps a part on when the attribute is missing or says yes", () => {
    const switches = [null, "", "true", "on", "yes"].map(parseSwitch);

    expect(switches).toEqual([true, true, true, true, true]);
  });

  it("turns a part off for the usual words for no, in any case and with spaces", () => {
    const switches = ["false", " OFF ", "no", "0", "none", "Hidden"].map(parseSwitch);

    expect(switches).toEqual([false, false, false, false, false, false]);
  });

  it("keeps a part on for a value it does not know", () => {
    const value = parseSwitch("maybe");

    expect(value).toBe(true);
  });
});
