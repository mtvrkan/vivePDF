import { describe, expect, it } from "vitest";
import { cleanCopiedText, reflowParagraphs } from "./copyText";

describe("cleanCopiedText", () => {
  it("strips leading line numbers from code listings", () => {
    const lines = ["1 #include <stdio.h>", "2 int main() {", "3     printf(\"hi\");", "4     return 0;", "5 }"];
    expect(cleanCopiedText(lines)).toBe("#include <stdio.h>\nint main() {\n    printf(\"hi\");\n    return 0;\n}");
  });

  it("drops a separately selected line-number column and keeps prose untouched", () => {
    expect(cleanCopiedText(["1", "2", "3", "int a = 1;", "int b = 2;", "return a + b;"])).toBe("int a = 1;\nint b = 2;\nreturn a + b;");
    expect(cleanCopiedText(["Bir sözcük kök ve eklerden oluşur.", "2023 yılında 3 ders vardı."])).toBe("Bir sözcük kök ve eklerden oluşur.\n2023 yılında 3 ders vardı.");
  });

  it("normalizes ligatures, non-breaking spaces and trailing whitespace", () => {
    expect(cleanCopiedText(["ﬁle name  ", "“quoted”"])).toBe("file name\n\"quoted\"");
  });

  it("joins words broken across lines and drops soft hyphens", () => {
    expect(cleanCopiedText(["The experi-", "ment was repeated twice."])).toBe("The experiment\nwas repeated twice.");
    expect(cleanCopiedText(["gelecek-", "teki çalışmalar", "de\u00adği\u00adşim"])).toBe("gelecekteki\nçalışmalar\ndeğişim");
    expect(cleanCopiedText(["Smith-", "Jones (2020) found"])).toBe("Smith-\nJones (2020) found");
    expect(cleanCopiedText(["x = a -", "b"])).toBe("x = a -\nb");
  });

  it("keeps a hyphen drawn with the soft hyphen code outside a word", () => {
    expect(cleanCopiedText(["\u00ad bullet entry", "2024\u00ad2025 plan", "range 3 \u00ad 5"])).toBe("- bullet entry\n2024-2025 plan\nrange 3 - 5");
  });

  it("joins a word broken with a soft hyphen and keeps it before a capital", () => {
    expect(cleanCopiedText(["gelecek\u00ad", "teki çalışmalar"])).toBe("gelecekteki\nçalışmalar");
    expect(cleanCopiedText(["Smith\u00ad", "Jones (2020)"])).toBe("Smith-\nJones (2020)");
  });

  it("reflows wrapped lines into paragraphs but keeps list items and blank-line breaks", () => {
    expect(reflowParagraphs("The experiment\nwas repeated twice.\n\nSecond  paragraph\nends here.")).toBe("The experiment was repeated twice.\n\nSecond paragraph ends here.");
    expect(reflowParagraphs("Findings:\n1. first point\ncontinues\n2. second point\n• bullet")).toBe("Findings:\n\n1. first point continues\n\n2. second point\n\n• bullet");
    expect(reflowParagraphs("   \n")).toBe("");
  });

  it("splits per-page strings containing embedded CRLF line breaks before cleaning", () => {
    expect(cleanCopiedText(["1 int a = 1;\r\n2 int b = 2;\r\n3 return a + b;"])).toBe("int a = 1;\nint b = 2;\nreturn a + b;");
  });
});
