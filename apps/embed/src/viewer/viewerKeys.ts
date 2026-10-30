export type ViewerKeyAction = "search" | "zoomIn" | "zoomOut" | "fitWidth" | "firstPage" | "lastPage" | "copy";

type KeyInput = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean };

export function viewerKeyAction(event: KeyInput, typing: boolean): ViewerKeyAction | null {
  const command = (event.ctrlKey || event.metaKey) && !event.altKey;
  const key = event.key.toLowerCase();
  if (command && key === "f") return "search";
  if (typing) return null;
  if (command && key === "c") return "copy";
  if (command && (key === "+" || key === "=")) return "zoomIn";
  if (command && (key === "-" || key === "_")) return "zoomOut";
  if (command && key === "0") return "fitWidth";
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (key === "home") return "firstPage";
  if (key === "end") return "lastPage";
  return null;
}
