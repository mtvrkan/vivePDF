export type DrawKeyAction = "undo" | "redo" | "remove" | "dropTool";

type KeyInput = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean };

export function drawKeyAction(event: KeyInput, typing: boolean): DrawKeyAction | null {
  if (typing || event.altKey) return null;
  const key = event.key.toLowerCase();
  const command = event.ctrlKey || event.metaKey;
  if (command && key === "z") return event.shiftKey ? "redo" : "undo";
  if (command && key === "y" && !event.shiftKey) return "redo";
  if (command || event.shiftKey) return null;
  if (key === "delete" || key === "backspace") return "remove";
  if (key === "escape") return "dropTool";
  return null;
}
