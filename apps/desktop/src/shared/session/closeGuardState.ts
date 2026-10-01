import { useDocumentStore } from "@/shared/store/documentStore";
import { useOperationStore } from "@/shared/store/operationStore";
import { usePreferencesStore } from "@/shared/store/preferencesStore";

export type CloseWarning = { documents: number; operations: number };

let bypass = false;
let listeners = 0;
let trayActive = false;
let quitting = false;

export function allowClose() {
  bypass = true;
}

export function registerCloseGuard() {
  listeners += 1;
  return () => {
    listeners -= 1;
  };
}

export function shouldConfirmClose(): CloseWarning | null {
  if (bypass || listeners === 0 || !usePreferencesStore.getState().confirmClose) return null;
  const documents = Object.keys(useDocumentStore.getState().documents).length;
  const operations = useOperationStore.getState().running;
  return documents > 0 || operations > 0 ? { documents, operations } : null;
}

export function setTrayActive(active: boolean) {
  trayActive = active;
}

export function requestQuit() {
  quitting = true;
}

export function cancelQuit() {
  quitting = false;
}

export function hidesOnClose(): boolean {
  return trayActive && !quitting;
}
