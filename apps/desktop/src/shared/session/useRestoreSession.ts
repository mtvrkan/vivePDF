import { useRef } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useDocumentManagerCapability } from "@embedpdf/plugin-document-manager/react";
import { useOrganizerStore } from "@/features/pages/organizerStore";
import { useOpenPdf } from "@/features/viewer/useOpenPdf";
import { groupedOrder, isGroupColor, nextColor, useTabGroupStore } from "@/features/viewer/tabGroups";
import { basenameOf, pathKey } from "@/shared/lib/paths";
import { useDocumentStore } from "@/shared/store/documentStore";
import { useToastStore } from "@/shared/store/toastStore";
import type { SessionSnapshot } from "@/types";

const ENGINE_POLL_MS = 100;
const ENGINE_TIMEOUT_MS = 15000;

function restoreGroups(snapshot: SessionSnapshot, restored: Array<{ id: string; path: string }>) {
  if (!snapshot.tabGroups?.length) return;
  const byPath = new Map(restored.map((doc) => [pathKey(doc.path), doc.id]));
  const groups = useTabGroupStore.getState();
  groups.restore(
    snapshot.tabGroups.map((group) => ({
      name: typeof group.name === "string" ? group.name.slice(0, 40) : "",
      color: isGroupColor(group.color) ? group.color : nextColor([]),
      collapsed: group.collapsed === true,
      documentIds: (Array.isArray(group.paths) ? group.paths : []).map((path) => byPath.get(pathKey(path))).filter((id): id is string => !!id),
    })),
  );
  const documents = useDocumentStore.getState();
  useDocumentStore.setState({ order: groupedOrder(documents.order, useTabGroupStore.getState().memberOf) });
}

export function useRestoreSession() {
  const { openPath } = useOpenPdf();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const toast = useToastStore((state) => state.push);
  const { provides: documentManager } = useDocumentManagerCapability();
  const managerRef = useRef(documentManager);
  managerRef.current = documentManager;
  const openRef = useRef(openPath);
  openRef.current = openPath;

  const waitForEngine = async () => {
    const deadline = Date.now() + ENGINE_TIMEOUT_MS;
    while (!managerRef.current && Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, ENGINE_POLL_MS));
    }
    return Boolean(managerRef.current);
  };

  return async (snapshot: SessionSnapshot): Promise<boolean> => {
    if (snapshot.documents.length === 0) return false;
    if (!(await waitForEngine())) {
      toast("error", t("recovery.engineUnavailable"));
      return false;
    }
    const failed: string[] = [];
    for (const path of snapshot.documents) {
      if (!(await openRef.current(path))) failed.push(path);
    }
    const documents = useDocumentStore.getState();
    const restored = Object.values(documents.documents);
    if (restored.length === 0) {
      toast("error", t("recovery.restoreFailed"));
      return false;
    }
    if (failed.length > 0) {
      toast("error", t("recovery.restorePartial", { count: failed.length, name: basenameOf(failed[0]) }));
    }
    restoreGroups(snapshot, restored);
    const restoredKeys = new Set(snapshot.documents.map(pathKey));
    const openedMeanwhile = restored.filter((doc) => !restoredKeys.has(pathKey(doc.path)));
    const latestOpened = openedMeanwhile[openedMeanwhile.length - 1];
    if (latestOpened) {
      documents.activate(latestOpened.id, managerRef.current);
      return true;
    }
    const active = restored.find((doc) => doc.path === snapshot.activePath) ?? restored[0];
    documents.activate(active.id, managerRef.current);
    if (snapshot.organizer && active.path === snapshot.organizer.mainPath) {
      useOrganizerStore.getState().restore(snapshot.organizer, active.id, active.password);
    }
    void navigate(snapshot.route || "/");
    return true;
  };
}
