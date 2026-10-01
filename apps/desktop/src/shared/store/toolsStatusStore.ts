import { create } from "zustand";
import { toolsStatus } from "@/shared/rpc/operations";
import type { AsyncStatus, ToolsStatus } from "@/types";

type ToolsStatusState = {
  status: AsyncStatus;
  tools: ToolsStatus | null;
  refresh: () => Promise<void>;
};

export const useToolsStatusStore = create<ToolsStatusState>((set, get) => ({
  status: "idle",
  tools: null,
  refresh: async () => {
    if (get().status === "loading") return;
    set({ status: "loading" });
    try {
      const tools = await toolsStatus();
      set({ tools, status: "success" });
    } catch {
      set({ status: "error" });
    }
  },
}));
