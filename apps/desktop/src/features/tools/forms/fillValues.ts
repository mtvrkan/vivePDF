import type { FormField } from "@/types";

export type FormValue = string | boolean | string[];
export type FormValues = Record<string, FormValue>;

export const FILLABLE_KINDS = ["text", "checkbox", "radio", "combobox", "listbox"];

export function initialValueOf(field: FormField): FormValue {
  if (field.multiSelect) return Array.isArray(field.value) ? field.value : [];
  if (field.kind === "checkbox") return field.value === true;
  return typeof field.value === "string" ? field.value : "";
}

export function initialValues(fields: FormField[]): FormValues {
  const values: FormValues = {};
  for (const field of fields) {
    if (FILLABLE_KINDS.includes(field.kind)) values[field.name] = initialValueOf(field);
  }
  return values;
}

function sameValue(left: FormValue | undefined, right: FormValue | undefined): boolean {
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, index) => item === right[index]);
  return left === right;
}

export function changedValues(fields: FormField[], initial: FormValues, current: FormValues): FormValues {
  const changed: FormValues = {};
  for (const field of fields) {
    const value = current[field.name];
    if (value !== undefined && !sameValue(value, initial[field.name])) changed[field.name] = value;
  }
  return changed;
}

export function isEmptyValue(value: FormValue | undefined): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "string") return value.trim().length === 0;
  return value !== true;
}

export function emptyRequired(fields: FormField[], values: FormValues): FormField[] {
  return fields.filter((field) => field.required && field.kind !== "checkbox" && isEmptyValue(values[field.name]));
}

export function optionLabel(field: FormField, option: string): string {
  const index = field.options.indexOf(option);
  const label = index >= 0 ? field.optionLabels?.[index] : undefined;
  return label || option;
}
