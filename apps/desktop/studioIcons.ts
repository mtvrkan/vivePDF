import { createRequire } from "node:module";
import type { Plugin } from "vite";

const MODULE_ID = "virtual:studio-icons";
const RESOLVED_ID = `\0${MODULE_ID}`;

type IconNode = [string, Record<string, string>][];
type DrawableIcon = { render?: (props: object, ref: null) => { props?: { iconNode?: unknown } } };

function drawingOf(name: string, icon: DrawableIcon): IconNode {
  const node = icon.render?.({}, null)?.props?.iconNode;
  if (!Array.isArray(node)) throw new Error(`lucide-react no longer exposes the drawing of ${name}`);
  return node.map(([tag, attrs]: [string, Record<string, string>]) => [tag, Object.fromEntries(Object.entries(attrs).filter(([key]) => key !== "key"))]);
}

export function lucideIconData(): [string, IconNode][] {
  const require = createRequire(import.meta.url);
  const { icons } = require("lucide-react") as { icons: Record<string, DrawableIcon> };
  return Object.entries(icons)
    .map(([name, icon]): [string, IconNode] => [name, drawingOf(name, icon)])
    .sort(([left], [right]) => left.localeCompare(right, "en"));
}

export function studioIcons(): Plugin {
  let source: string | null = null;
  return {
    name: "vivepdf-studio-icons",
    resolveId: (id) => (id === MODULE_ID ? RESOLVED_ID : null),
    load(id) {
      if (id !== RESOLVED_ID) return null;
      source ??= `export default JSON.parse(${JSON.stringify(JSON.stringify(lucideIconData()))});`;
      return source;
    },
  };
}
