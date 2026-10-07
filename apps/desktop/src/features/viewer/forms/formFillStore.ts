import { create } from "zustand";
import { changedValues, FILLABLE_KINDS, initialValues, type FormValue, type FormValues } from "@/features/tools/forms/fillValues";
import { usePendingChangesStore } from "@/shared/store/pendingChangesStore";
import type { FieldsResult } from "@/types";

export type FieldsLoad = { state: "loading" } | { state: "failed" } | { state: "loaded"; result: FieldsResult; initial: FormValues };

type FormFillState = {
  loads: Record<string, FieldsLoad>;
  values: Record<string, FormValues>;
  setLoad: (documentId: string, load: FieldsLoad) => void;
  setValue: (documentId: string, name: string, value: FormValue, label: string) => void;
  reset: (documentId: string) => void;
};

function without<T>(record: Record<string, T>, documentId: string): Record<string, T> {
  if (!(documentId in record)) return record;
  const next = { ...record };
  delete next[documentId];
  return next;
}

export function loadedFields(result: FieldsResult): FieldsLoad {
  return { state: "loaded", result, initial: initialValues(result.fields) };
}

export function isXfaOnly(load: FieldsLoad | null): boolean {
  return load?.state === "loaded" && load.result.xfa && !load.result.fields.some((field) => FILLABLE_KINDS.includes(field.kind));
}

export const useFormFillStore = create<FormFillState>((set, get) => ({
  loads: {},
  values: {},
  setLoad: (documentId, load) => set((state) => ({ loads: { ...state.loads, [documentId]: load } })),
  setValue: (documentId, name, value, label) => {
    const load = get().loads[documentId];
    if (load?.state !== "loaded") return;
    const values = { ...get().values[documentId], [name]: value };
    set((state) => ({ values: { ...state.values, [documentId]: values } }));
    const changed = changedValues(load.result.fields, load.initial, values);
    const pending = usePendingChangesStore.getState();
    if (Object.keys(changed).length > 0) {
      pending.replace(documentId, { kind: "formFilled", values: changed, label });
      return;
    }
    const existing = (pending.changes[documentId] ?? []).find((change) => change.kind === "formFilled");
    if (existing) pending.drop(documentId, existing.id);
  },
  reset: (documentId) => set((state) => ({ values: without(state.values, documentId) })),
}));

export function valueOf(documentId: string, name: string): FormValue | undefined {
  const state = useFormFillStore.getState();
  const own = state.values[documentId]?.[name];
  if (own !== undefined) return own;
  const load = state.loads[documentId];
  return load?.state === "loaded" ? load.initial[name] : undefined;
}

usePendingChangesStore.subscribe((pending) => {
  const { values, reset } = useFormFillStore.getState();
  for (const documentId of Object.keys(values)) {
    const stillPending = (pending.changes[documentId] ?? []).some((change) => change.kind === "formFilled");
    if (!stillPending) reset(documentId);
  }
});
