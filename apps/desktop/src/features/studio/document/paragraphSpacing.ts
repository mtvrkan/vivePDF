import { Extension } from "@tiptap/core";
import { SPACING_KEYS, SPACING_TYPES, parsedSpacing, spacingCss, spacingOf, spacingValue, type Spacing, type SpacingKey } from "./spacing";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    paragraphSpacing: { setSpacing: (spacing: Partial<Spacing>) => ReturnType; unsetSpacing: () => ReturnType };
  }
}

export const ParagraphSpacing = Extension.create({
  name: "paragraphSpacing",
  addGlobalAttributes() {
    return [
      {
        types: SPACING_TYPES,
        attributes: Object.fromEntries(
          SPACING_KEYS.map((key) => [
            key,
            {
              default: null,
              parseHTML: (element: HTMLElement) => parsedSpacing(key, spacingOf(element, key)),
              renderHTML: (attributes: Record<string, unknown>) => {
                const css = spacingCss(key, attributes[key]);
                return css ? { style: css } : {};
              },
            },
          ]),
        ),
      },
    ];
  },
  addCommands() {
    return {
      setSpacing:
        (spacing) =>
        ({ commands }) => {
          const values = Object.fromEntries(Object.entries(spacing).map(([key, value]) => [key, spacingValue(key as SpacingKey, value)]));
          return SPACING_TYPES.map((type) => commands.updateAttributes(type, values)).some(Boolean);
        },
      unsetSpacing:
        () =>
        ({ commands }) =>
          SPACING_TYPES.map((type) => commands.resetAttributes(type, SPACING_KEYS)).some(Boolean),
    };
  },
});
