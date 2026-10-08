import i18n from "i18next";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { useToastStore } from "@/shared/store/toastStore";
import type { RpcError } from "@/types";
import type { StudioDesign } from "@/types/studio";
import { normalizeDesign } from "../model/design";

export const LEGACY_DRAFT_KEY = "vivepdf.studioDraft";
export const DRAFT_DELAY_MS = 600;
export const DRAFT_MAX_BYTES = 7 * 1024 * 1024;
const IDLE_TIMEOUT_MS = 1500;

export type StudioDraft = { design: StudioDesign; filePath: string | null };

let latest: StudioDraft | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let idle: number | null = null;
let chain: Promise<void> = Promise.resolve();
let reported: string | null = null;

const operations = () => import("@/shared/rpc/operations");

const translate = (key: string, options?: Record<string, unknown>) => i18n.t(key, options ?? {});

function utf8Length(text: string): number {
  return text.length * 3 <= DRAFT_MAX_BYTES ? text.length : new TextEncoder().encode(text).length;
}

function report(error: RpcError) {
  const kind = typeof error.data?.reason === "string" ? error.data.reason : error.code;
  if (reported === kind) return;
  reported = kind;
  const message = kind === "draftTooLarge" ? translate("studio.draft.tooLarge") : translate("studio.draft.failed", { error: describeError(translate, error) });
  useToastStore.getState().push("error", message);
}

async function persist(draft: StudioDraft): Promise<boolean> {
  try {
    if (utf8Length(JSON.stringify(draft.design)) > DRAFT_MAX_BYTES) {
      report({ code: "INVALID_PARAMS", message: "draft too large", data: { reason: "draftTooLarge" } });
      return false;
    }
    const { studioSaveDraft } = await operations();
    await studioSaveDraft({ design: draft.design, filePath: draft.filePath });
    reported = null;
    return true;
  } catch (caught) {
    report(toRpcError(caught));
    return false;
  }
}

function enqueue(draft: StudioDraft): Promise<void> {
  chain = chain
    .then(async () => {
      if (latest === draft) await persist(draft);
    })
    .catch(() => undefined);
  return chain;
}

function cancelIdle() {
  if (idle !== null) cancelIdleCallback(idle);
  idle = null;
}

function saveWhenIdle() {
  const save = () => {
    idle = null;
    if (latest) void enqueue(latest);
  };
  if (typeof requestIdleCallback !== "function") return save();
  cancelIdle();
  idle = requestIdleCallback(save, { timeout: IDLE_TIMEOUT_MS });
}

export function scheduleDraft(design: StudioDesign, filePath: string | null): void {
  latest = { design, filePath };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    saveWhenIdle();
  }, DRAFT_DELAY_MS);
}

export function flushDraft(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  if (typeof cancelIdleCallback === "function") cancelIdle();
  return latest ? enqueue(latest) : chain;
}

function readLegacyDraft(): StudioDraft | null {
  try {
    const raw = localStorage.getItem(LEGACY_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { design?: unknown; filePath?: unknown };
    const design = normalizeDesign(parsed.design);
    return design ? { design, filePath: typeof parsed.filePath === "string" ? parsed.filePath : null } : null;
  } catch {
    return null;
  }
}

function forgetLegacyDraft(): void {
  try {
    localStorage.removeItem(LEGACY_DRAFT_KEY);
  } catch {
    return;
  }
}

function hasLegacyDraft(): boolean {
  try {
    return localStorage.getItem(LEGACY_DRAFT_KEY) !== null;
  } catch {
    return false;
  }
}

export async function loadDraft(): Promise<StudioDraft | null> {
  if (latest) return latest;
  await chain;
  const { studioLoadDraft } = await operations();
  const stored = await studioLoadDraft();
  const design = stored.found ? normalizeDesign(stored.design) : null;
  if (design) {
    if (hasLegacyDraft()) forgetLegacyDraft();
    return { design, filePath: stored.filePath };
  }
  const legacy = readLegacyDraft();
  if (!legacy) {
    if (hasLegacyDraft()) forgetLegacyDraft();
    return null;
  }
  if (await persist(legacy)) forgetLegacyDraft();
  return legacy;
}
