import { useCallback, useEffect, useRef, useState } from "react";
import { useDocumentManagerCapability } from "@embedpdf/plugin-document-manager/react";
import type { OrganizerSource } from "@/types";
import { MAIN_SOURCE_ID, useOrganizerStore } from "./organizerStore";
import { useInsertSources } from "./useInsertSources";

export type LockedSource = { id: string; fileName: string; wrongPassword: boolean };

export function sourcesToReattach(sources: Record<string, OrganizerSource>, unavailable: ReadonlySet<string>, started: ReadonlySet<string>): OrganizerSource[] {
  return Object.values(sources).filter((source) => source.id !== MAIN_SOURCE_ID && !source.embedDocId && !unavailable.has(source.id) && !started.has(source.id));
}

export function useRestoredSources() {
  const { provides: docManager } = useDocumentManagerCapability();
  const { reattachSource } = useInsertSources();
  const sources = useOrganizerStore((state) => state.sources);
  const unavailable = useOrganizerStore((state) => state.unavailable);
  const markUnavailable = useOrganizerStore((state) => state.markUnavailable);
  const started = useRef(new Set<string>());
  const [locked, setLocked] = useState<LockedSource[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!docManager) return;
    for (const source of sourcesToReattach(sources, unavailable, started.current)) {
      started.current.add(source.id);
      void reattachSource(source, source.password).then((result) => {
        if (result.status === "password") setLocked((list) => [...list, { id: source.id, fileName: source.fileName, wrongPassword: false }]);
        else if (result.status === "error") markUnavailable(source.id);
      });
    }
  }, [docManager, sources, unavailable, reattachSource, markUnavailable]);

  const request = locked.find((item) => sources[item.id] && !sources[item.id].embedDocId) ?? null;

  const drop = useCallback((id: string) => setLocked((list) => list.filter((item) => item.id !== id)), []);

  const submit = useCallback(
    async (password: string) => {
      if (!request) return;
      const source = useOrganizerStore.getState().sources[request.id];
      if (!source) {
        drop(request.id);
        return;
      }
      setBusy(true);
      const result = await reattachSource(source, password);
      setBusy(false);
      if (result.status === "password") {
        setLocked((list) => list.map((item) => (item.id === request.id ? { ...item, wrongPassword: true } : item)));
        return;
      }
      if (result.status === "error") markUnavailable(request.id);
      drop(request.id);
    },
    [request, reattachSource, markUnavailable, drop],
  );

  const skip = useCallback(() => {
    if (!request) return;
    markUnavailable(request.id);
    drop(request.id);
  }, [request, markUnavailable, drop]);

  return { request, busy, submit, skip };
}
