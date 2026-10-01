import { useCallback, useState } from "react";
import type { ContextMenuAnchor } from "./ContextMenu";

export function useContextMenu() {
  const [anchor, setAnchor] = useState<ContextMenuAnchor | null>(null);

  const open = useCallback((event: { clientX: number; clientY: number; preventDefault: () => void }) => {
    event.preventDefault();
    setAnchor({ x: event.clientX, y: event.clientY });
  }, []);

  const openAt = useCallback((position: ContextMenuAnchor) => setAnchor(position), []);
  const close = useCallback(() => setAnchor(null), []);

  return { anchor, open, openAt, close };
}
