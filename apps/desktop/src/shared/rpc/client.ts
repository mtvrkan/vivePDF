import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ChainSecretKind, RpcError, RpcErrorCode, RpcProgress } from "@/types";

export type StoredSecretUse = { chainId: string; kinds: ChainSecretKind[]; ticket: string };

export type RpcCallOptions = {
  onProgress?: (progress: RpcProgress) => void;
  signal?: AbortSignal;
  secret?: StoredSecretUse;
};

export class RpcCallError extends Error {
  readonly code: RpcErrorCode;
  readonly data?: Record<string, unknown>;

  constructor(error: RpcError) {
    super(error.message);
    this.name = "RpcCallError";
    this.code = error.code;
    this.data = error.data;
  }

  toRpcError(): RpcError {
    return { code: this.code, message: this.message, data: this.data };
  }
}

export function isRpcError(value: unknown): value is RpcError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as RpcError).code === "string" &&
    typeof (value as RpcError).message === "string"
  );
}

export function toRpcError(error: unknown): RpcError {
  if (error instanceof RpcCallError) return error.toRpcError();
  if (isRpcError(error)) return error;
  return { code: "INTERNAL", message: error instanceof Error ? error.message : String(error) };
}

export async function rpc<TResult>(
  method: string,
  params: Record<string, unknown> = {},
  options: RpcCallOptions = {},
): Promise<TResult> {
  const id = crypto.randomUUID();
  let unlisten: UnlistenFn | undefined;
  if (options.onProgress) {
    const onProgress = options.onProgress;
    unlisten = await listen<RpcProgress>("rpc-progress", (event) => {
      if (event.payload.id === id) onProgress(event.payload);
    });
  }
  const onAbort = () => {
    void invoke("rpc_cancel", { target: id }).catch(() => undefined);
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (options.secret) {
      const { chainId, kinds, ticket } = options.secret;
      return await invoke<TResult>("rpc_with_chain_secret", { id, method, params, chainId, kinds, ticket });
    }
    return await invoke<TResult>("rpc", { id, method, params });
  } catch (error) {
    throw new RpcCallError(toRpcError(error));
  } finally {
    unlisten?.();
    options.signal?.removeEventListener("abort", onAbort);
  }
}
