import { useCallback, useState } from "react";
import { useOrganizerStore } from "./organizerStore";
import { toggledSelection } from "./tileSelection";
import type { OrganizerEdits } from "./useOrganizerEdits";

type PreviewEdits = Pick<OrganizerEdits, "moveSelection" | "scrollToTile">;

export function usePagePreview({ moveSelection, scrollToTile }: PreviewEdits) {
  const select = useOrganizerStore((state) => state.select);
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  const open = useCallback(
    (key: string) => {
      const state = useOrganizerStore.getState();
      if (state.anchor !== key) select(state.selected, key);
      setPreviewKey(key);
    },
    [select],
  );

  const close = useCallback(() => setPreviewKey(null), []);

  const step = useCallback(
    (delta: number, extend: boolean) => {
      const state = useOrganizerStore.getState();
      const position = state.tiles.findIndex((tile) => tile.key === previewKey);
      if (position < 0 || !previewKey) return;
      const target = Math.max(0, Math.min(state.tiles.length - 1, position + delta));
      const next = state.tiles[target];
      if (!next || target === position) return;
      if (extend) {
        if (state.anchor !== previewKey) select(state.selected, previewKey);
        moveSelection(target - position, true);
      } else {
        select(state.selected, next.key);
        scrollToTile(next.key);
      }
      setPreviewKey(next.key);
    },
    [previewKey, select, moveSelection, scrollToTile],
  );

  const toggle = useCallback(() => {
    if (!previewKey) return;
    const state = useOrganizerStore.getState();
    if (!state.tiles.some((tile) => tile.key === previewKey)) return;
    select(toggledSelection(state.selected, previewKey), previewKey);
  }, [previewKey, select]);

  return { previewKey, open, close, step, toggle };
}
