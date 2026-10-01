import axe from "axe-core";

const JSDOM_UNSUPPORTED_RULES = { "color-contrast": { enabled: false }, region: { enabled: false } };

export async function axeViolations(context: Element | Document = document): Promise<string[]> {
  const result = await axe.run(context, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
    rules: JSDOM_UNSUPPORTED_RULES,
  });
  return result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(" | ")}`);
}
