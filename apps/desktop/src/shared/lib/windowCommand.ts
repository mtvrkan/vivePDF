import { useToastStore } from "@/shared/store/toastStore";

export function runWindowCommand(command: () => Promise<void>) {
  command().catch((error: unknown) => {
    useToastStore.getState().push("error", error instanceof Error ? error.message : String(error));
  });
}
