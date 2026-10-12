import type { CheckSourcesResult, DetectDoiResult, LookupDoiResult } from "@/types";
import { rpc, type RpcCallOptions } from "./client";

export const lookupDoi = (params: { doi: string }, options?: RpcCallOptions) => rpc<LookupDoiResult>("sources.lookup_doi", params, options);
export const detectDoi = (params: { path: string; password?: string | null }, options?: RpcCallOptions) => rpc<DetectDoiResult>("sources.detect_doi", params, options);
export const checkSources = (params: { dois: string[] }, options?: RpcCallOptions) => rpc<CheckSourcesResult>("sources.check", params, options);
