import type { PresenterCommand } from "./presenterChannel";

export type CommandTarget = {
  currentPage: number;
  totalPages: number;
  goToPage: (pageNumber: number) => void;
  toggleBlackout: (mode: "black" | "white") => void;
  clearBlackout: () => void;
  end: () => void;
};

export function applyCommand(command: PresenterCommand, target: CommandTarget): void {
  const { currentPage, totalPages } = target;
  if (command === "next") {
    if (currentPage < totalPages) target.goToPage(currentPage + 1);
  } else if (command === "previous") {
    if (currentPage > 1) target.goToPage(currentPage - 1);
  } else if (command === "first") {
    if (currentPage !== 1) target.goToPage(1);
  } else if (command === "last") {
    if (totalPages > 0 && currentPage !== totalPages) target.goToPage(totalPages);
  } else if (command === "blackoutBlack") target.toggleBlackout("black");
  else if (command === "blackoutWhite") target.toggleBlackout("white");
  else if (command === "clearBlackout") target.clearBlackout();
  else target.end();
}

const KEY_COMMANDS: Record<string, PresenterCommand> = {
  ArrowRight: "next",
  ArrowDown: "next",
  PageDown: "next",
  " ": "next",
  Enter: "next",
  ArrowLeft: "previous",
  ArrowUp: "previous",
  PageUp: "previous",
  Backspace: "previous",
  Home: "first",
  End: "last",
  Escape: "end",
};

export function commandForKey(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): PresenterCommand | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const letter = event.key.toLowerCase();
  if (letter === "b" || event.key === ".") return "blackoutBlack";
  if (letter === "w" || event.key === ",") return "blackoutWhite";
  if (event.key === " " && event.shiftKey) return "previous";
  return KEY_COMMANDS[event.key] ?? null;
}
