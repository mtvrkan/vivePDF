import type { Permissions } from "@/types";

export const PERMISSION_KEYS: Array<keyof Permissions> = ["print", "printHighQuality", "copyText", "modify", "annotate", "fillForms", "accessibility", "assemble"];

export const PERMISSION_PRESETS: Record<string, Partial<Permissions>> = {
  open: { print: true, printHighQuality: true, copyText: true, modify: true, annotate: true, fillForms: true, accessibility: true, assemble: true },
  readOnly: { print: true, printHighQuality: true, copyText: true, modify: false, annotate: false, fillForms: false, accessibility: true, assemble: false },
  noCopy: { print: true, printHighQuality: true, copyText: false, modify: false, annotate: false, fillForms: true, accessibility: true, assemble: false },
  locked: { print: false, printHighQuality: false, copyText: false, modify: false, annotate: false, fillForms: false, accessibility: true, assemble: false },
};

export const PERMISSION_PRESET_KEYS = Object.keys(PERMISSION_PRESETS);

export const ALL_PERMISSIONS: Permissions = {
  print: true,
  printHighQuality: true,
  copyText: true,
  modify: true,
  annotate: true,
  fillForms: true,
  accessibility: true,
  assemble: true,
};

export function isRestricted(permissions: Permissions): boolean {
  return PERMISSION_KEYS.some((key) => !permissions[key]);
}
