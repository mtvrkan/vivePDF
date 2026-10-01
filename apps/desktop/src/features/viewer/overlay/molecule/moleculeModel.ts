export type MoleculeSettings = {
  smiles: string;
  color: string;
  colorAtoms: boolean;
  terminalCarbons: boolean;
};

export type MoleculeLook = Omit<MoleculeSettings, "smiles">;

export const MAX_SMILES_CHARS = 1000;
export const MOLECULE_POINTS_PER_UNIT = 0.75;

export const DEFAULT_MOLECULE_LOOK: MoleculeLook = { color: "#111111", colorAtoms: true, terminalCarbons: false };

export const MOLECULE_EXAMPLES = [
  { id: "ethanol", smiles: "CCO" },
  { id: "benzene", smiles: "c1ccccc1" },
  { id: "alanine", smiles: "C[C@@H](C(=O)O)N" },
  { id: "glucose", smiles: "OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O" },
  { id: "aspirin", smiles: "CC(=O)Oc1ccccc1C(=O)O" },
  { id: "paracetamol", smiles: "CC(=O)Nc1ccc(O)cc1" },
  { id: "caffeine", smiles: "CN1C=NC2=C1C(=O)N(C(=O)N2C)C" },
] as const;

const ELEMENT_COLORS: Record<string, string> = {
  O: "#c62828",
  N: "#1e4fb8",
  S: "#9a7400",
  P: "#c05600",
  F: "#2e7d32",
  CL: "#1b7a5a",
  BR: "#8d3a12",
  I: "#6a1b9a",
  B: "#b3591b",
  SI: "#b3591b",
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function moleculeColor(color: string): string {
  return HEX_COLOR.test(color) ? color : DEFAULT_MOLECULE_LOOK.color;
}

export function moleculeTheme(look: Pick<MoleculeLook, "color" | "colorAtoms">): Record<string, string> {
  const ink = moleculeColor(look.color);
  const elements = look.colorAtoms ? ELEMENT_COLORS : Object.fromEntries(Object.keys(ELEMENT_COLORS).map((key) => [key, ink]));
  return { ...elements, C: ink, H: ink, FOREGROUND: ink, BACKGROUND: "#ffffff" };
}

export function cleanSmiles(smiles: string): string {
  return smiles.replace(/\s+/g, "").slice(0, MAX_SMILES_CHARS);
}
