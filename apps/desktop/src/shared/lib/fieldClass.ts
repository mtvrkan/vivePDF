import { extendTailwindMerge } from "tailwind-merge";

const merge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: ["row", "topbar", "inspector", "section"],
      text: ["display"],
      ease: ["enter"],
    },
  },
});

export function fieldClass(...parts: Array<string | false | null | undefined>): string {
  return merge(parts.filter(Boolean).join(" "));
}
