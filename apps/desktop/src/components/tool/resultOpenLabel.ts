import { isPdfPath } from "@/shared/rpc/files";

export function resultOpenLabelKey(output: string): "tools.openResult" | "tools.openFile" {
  return isPdfPath(output) ? "tools.openResult" : "tools.openFile";
}
