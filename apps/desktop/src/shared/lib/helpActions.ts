import { invoke } from "@tauri-apps/api/core";
import i18n from "@/app/i18n";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { useToastStore } from "@/shared/store/toastStore";
import { useUpdateStore } from "@/shared/store/updateStore";

export async function openLogFolder(): Promise<void> {
  try {
    await invoke("open_log_dir");
  } catch (error) {
    useToastStore.getState().push("error", describeError(i18n.t, toRpcError(error)));
  }
}

export function checkUpdatesNow(navigate: (to: string) => unknown): void {
  void navigate("/settings?section=updates");
  void useUpdateStore.getState().check(true);
}
