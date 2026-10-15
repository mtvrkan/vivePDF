import { openUrl } from "@tauri-apps/plugin-opener";
import { refuseWhenOffline } from "@/shared/lib/offline";

export async function openExternal(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  if (refuseWhenOffline()) return;
  await openUrl(parsed.toString());
}
