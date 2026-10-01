import { describe, expect, it } from "vitest";
import { passwordScore, passwordStrength } from "./passwordStrength";

describe("password strength", () => {
  it("calls a short or repetitive password weak", () => {
    expect(passwordStrength("")).toBe("weak");
    expect(passwordStrength("abc")).toBe("weak");
    expect(passwordStrength("aaaaaaaaaaaa")).toBe("weak");
    expect(passwordScore("123456")).toBe(0);
  });

  it("rates a long mixed password strong", () => {
    expect(passwordStrength("Tr0ubador&Şifre")).toBe("strong");
  });

  it("places an ordinary password in between", () => {
    expect(passwordStrength("deneme12")).toBe("fair");
    expect(passwordStrength("Deneme123456")).toBe("good");
  });

  it("calls a breached password weak however long and mixed it is", () => {
    expect(passwordStrength("Tr0ubador&Şifre", true)).toBe("weak");
    expect(passwordStrength("Tr0ubador&Şifre", false)).toBe("strong");
  });

  it("counts Turkish letters as letters", () => {
    expect(passwordScore("şığüöç1A!")).toBeGreaterThan(passwordScore("abc"));
  });
});
