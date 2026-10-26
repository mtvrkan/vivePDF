import { useState } from "react";

const COLLAPSED_KEY = "vivepdf.ribbonCollapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function storeCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, String(collapsed));
  } catch {
    return;
  }
}

export function useRibbonCollapsed(): [boolean, (collapsed: boolean) => void] {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const change = (next: boolean) => {
    storeCollapsed(next);
    setCollapsed(next);
  };
  return [collapsed, change];
}
