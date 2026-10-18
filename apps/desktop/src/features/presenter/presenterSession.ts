import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { onImmersiveExit, setImmersiveFullscreen } from "@/features/viewer/immersive";
import * as logger from "@/shared/lib/logger";
import { RpcCallError, toRpcError } from "@/shared/rpc/client";
import { useDocumentStore } from "@/shared/store/documentStore";
import { readPrefs, usePresentationStore } from "@/shared/store/presentationStore";
import { useUiStore } from "@/shared/store/uiStore";

export type PresenterOpened = { label: string; external: boolean; width: number; height: number; screens: number };

export type AudienceProblem = "closed" | "failed";

export type PresenterSession = { documentId: string; path: string; audience: string; external: boolean; aspect: number; problem: AudienceProblem | null };

type PresenterRequest = { documentId: string; startPage: number | null };

type PresenterState = {
  session: PresenterSession | null;
  request: PresenterRequest | null;
  requestPresenter: (documentId: string, startPage: number | null) => void;
  clearRequest: () => void;
  markProblem: (problem: AudienceProblem) => void;
  setOpened: (opened: PresenterOpened) => void;
};

const DEFAULT_ASPECT = 16 / 9;

function aspectOf(opened: PresenterOpened): number {
  return opened.width > 0 && opened.height > 0 ? opened.width / opened.height : DEFAULT_ASPECT;
}

export const usePresenterStore = create<PresenterState>((set) => ({
  session: null,
  request: null,
  requestPresenter: (documentId, startPage) => set({ request: { documentId, startPage } }),
  clearRequest: () => set({ request: null }),
  markProblem: (problem) => set((state) => (state.session ? { session: { ...state.session, problem } } : state)),
  setOpened: (opened) => set((state) => (state.session ? { session: { ...state.session, audience: opened.label, external: opened.external, aspect: aspectOf(opened), problem: null } } : state)),
}));

function logOpened(action: string, opened: PresenterOpened): void {
  logger.info("presenter", `${action}: ${opened.screens} screen(s), ${opened.external ? "audience on the other screen" : "rehearsal window"}, ${opened.width}x${opened.height}`);
}

async function callPresenter(command: string, args?: Record<string, unknown>): Promise<PresenterOpened> {
  try {
    const opened = await invoke<PresenterOpened>(command, args);
    logOpened(command, opened);
    return opened;
  } catch (error) {
    const rpcError = toRpcError(error);
    logger.warn("presenter", `${command} failed: ${rpcError.code} ${rpcError.message}`);
    throw new RpcCallError(rpcError);
  }
}

function openAudience(path: string, password: string | null, startPage: number): Promise<PresenterOpened> {
  return callPresenter("presenter_open", { path, password, startPage: Math.max(0, startPage - 1) });
}

export async function countScreens(): Promise<number | null> {
  try {
    return await invoke<number>("presenter_screens");
  } catch (error) {
    logger.warn("presenter", `presenter_screens failed: ${toRpcError(error).message}`);
    return null;
  }
}

export async function startPresenter(documentId: string, startPage: number): Promise<void> {
  const document = useDocumentStore.getState().documents[documentId];
  if (!document) return;
  const opened = await openAudience(document.path, document.password ?? null, startPage);
  usePresenterStore.setState({ session: { documentId, path: document.path, audience: opened.label, external: opened.external, aspect: aspectOf(opened), problem: null } });
  usePresentationStore.setState({ drawingsMode: "temporary" });
  if (opened.external) await setImmersiveFullscreen(true, startPage);
  else useUiStore.getState().setImmersive(true, startPage);
}

export async function reopenAudience(startPage: number): Promise<void> {
  const session = usePresenterStore.getState().session;
  if (!session) return;
  const document = useDocumentStore.getState().documents[session.documentId];
  const opened = await openAudience(session.path, document?.password ?? null, startPage);
  usePresenterStore.getState().setOpened(opened);
}

export async function swapScreens(): Promise<void> {
  usePresenterStore.getState().setOpened(await callPresenter("presenter_swap"));
}

export async function moveAudienceToScreen(currentPage: number): Promise<void> {
  usePresenterStore.getState().setOpened(await callPresenter("presenter_move"));
  await setImmersiveFullscreen(true, currentPage);
}

export function endPresenter(): void {
  if (!usePresenterStore.getState().session) return;
  usePresenterStore.setState({ session: null });
  usePresentationStore.setState({ drawingsMode: readPrefs().drawingsMode });
  void invoke("presenter_close").catch(() => undefined);
}

export function closeStaleAudience(): void {
  void invoke("presenter_close").catch(() => undefined);
}

onImmersiveExit(endPresenter);
