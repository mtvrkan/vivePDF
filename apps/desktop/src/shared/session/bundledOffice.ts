import { create } from "zustand";
import i18n from "@/app/i18n";
import { describeError } from "@/shared/lib/errorMessage";
import { toRpcError } from "@/shared/rpc/client";
import { officeInstall, officeStatus } from "@/shared/rpc/office";
import { useToastStore } from "@/shared/store/toastStore";
import { useToolsStatusStore } from "@/shared/store/toolsStatusStore";

const ATTEMPTED_KEY = "vivepdf.bundledOfficeAttempted";

export const useBundledOfficeStore = create<{ running: boolean }>(() => ({ running: false }));

function attempted(): boolean {
  try {
    return localStorage.getItem(ATTEMPTED_KEY) === "1";
  } catch {
    return false;
  }
}

function markAttempted() {
  try {
    localStorage.setItem(ATTEMPTED_KEY, "1");
  } catch {
    return;
  }
}

export async function prepareBundledOffice(): Promise<boolean> {
  if (attempted() || useBundledOfficeStore.getState().running) return false;
  let status;
  try {
    status = await officeStatus();
  } catch {
    return false;
  }
  if (status.installed || !status.bundled) return false;
  markAttempted();
  useBundledOfficeStore.setState({ running: true });
  const toast = useToastStore.getState().push;
  try {
    await officeInstall();
    toast("success", i18n.t("settings.office.bundledReady"));
    void useToolsStatusStore.getState().refresh();
    return true;
  } catch (caught) {
    toast("error", `${i18n.t("settings.office.bundledFailed")} ${describeError(i18n.t, toRpcError(caught))}`);
    return false;
  } finally {
    useBundledOfficeStore.setState({ running: false });
  }
}
