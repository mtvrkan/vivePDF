import SmilesDrawer from "smiles-drawer";
import { cleanSmiles, moleculeColor, moleculeTheme, type MoleculeLook } from "./moleculeModel";
import { normalizeMoleculeSvg, type MoleculeArt } from "./moleculeSvg";

export type MoleculeDrawing = MoleculeArt | { error: "empty" | "invalid" | "drawFailed"; position: number | null };

const THEME = "print";
const SVG_NS = "http://www.w3.org/2000/svg";

type ParseFailure = { location?: number | { start?: { offset?: number } } };

function failurePosition(failure: unknown): number | null {
  const location = (failure as ParseFailure | null)?.location;
  const offset = typeof location === "object" ? location?.start?.offset : undefined;
  return typeof offset === "number" ? offset + 1 : null;
}

function parseSmiles(smiles: string): { tree: unknown } | { failure: unknown } {
  let outcome: { tree: unknown } | { failure: unknown } = { failure: null };
  SmilesDrawer.parse(
    smiles,
    (tree) => {
      outcome = { tree };
    },
    (failure) => {
      outcome = { failure };
    },
  );
  return outcome;
}

export function drawMolecule(smiles: string, look: MoleculeLook): MoleculeDrawing {
  const source = cleanSmiles(smiles);
  if (!source) return { error: "empty", position: null };
  const parsed = parseSmiles(source);
  if ("failure" in parsed) return { error: "invalid", position: failurePosition(parsed.failure) };
  try {
    const target = document.createElementNS(SVG_NS, "svg");
    const drawer = new SmilesDrawer.SvgDrawer({ themes: { [THEME]: moleculeTheme(look) }, terminalCarbons: look.terminalCarbons });
    drawer.draw(parsed.tree, target, THEME);
    return normalizeMoleculeSvg(target, moleculeColor(look.color)) ?? { error: "drawFailed", position: null };
  } catch {
    return { error: "drawFailed", position: null };
  }
}
