import { invoke } from "@tauri-apps/api/core";
import { RpcCallError, toRpcError } from "./client";
import type { ChainSecretKind, ChainSecretStatus } from "@/types";

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new RpcCallError(toRpcError(error));
  }
}

export const storeChainSecret = (chainId: string, kind: ChainSecretKind, secret: string, certificatePath?: string) =>
  call<ChainSecretStatus>("chain_secret_store", { chainId, kind, secret, certificatePath: certificatePath || null });

export const chainSecretStatus = (chainIds: string[]) => call<ChainSecretStatus[]>("chain_secret_status", { chainIds });

export const deleteChainSecret = (chainId: string, kind?: ChainSecretKind) => call<void>("chain_secret_delete", { chainId, kind: kind ?? null });

export const pruneChainSecrets = (liveChainIds: string[]) => call<ChainSecretStatus[]>("chain_secret_prune", { liveChainIds });

export const purgeChainSecrets = () => call<number>("chain_secret_purge_all");

export const watchTicket = (ruleId: string, path: string) => call<string>("watch_ticket", { ruleId, path });

export async function releaseWatchTicket(ticket: string): Promise<void> {
  await invoke("watch_ticket_release", { ticket }).catch(() => undefined);
}
