import { create } from "zustand";
import { toRpcError } from "@/shared/rpc/client";
import { pingEngine } from "@/shared/rpc/documents";
import type { AsyncStatus, RpcError, SystemPingResult } from "@/types";

type EngineState = {
  status: AsyncStatus;
  info: SystemPingResult | null;
  error: RpcError | null;
  check: () => Promise<void>;
};

export const useEngineStore = create<EngineState>((set) => ({
  status: "idle",
  info: null,
  error: null,
  check: async () => {
    set({ status: "loading", error: null });
    try {
      const info = await pingEngine();
      set({ info, status: "success" });
    } catch (error) {
      set({ status: "error", error: toRpcError(error) });
    }
  },
}));
