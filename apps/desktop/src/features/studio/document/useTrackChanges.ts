import { useEditorState, type Editor } from "@tiptap/react";
import type { TrackedChange } from "./trackChanges";
import { changeAuthors, isTracking, trackedChanges, trackKey } from "./trackChangesMark";

export type TrackChangesState = { tracking: boolean; changes: TrackedChange[]; authors: string[]; active: string | null };

const EMPTY: TrackChangesState = { tracking: false, changes: [], authors: [], active: null };

export function useTrackChanges(editor: Editor | null): TrackChangesState {
  return (
    useEditorState({
      editor,
      selector: ({ editor: current }) => {
        if (!current) return EMPTY;
        const changes = trackedChanges(current.state.doc);
        return { tracking: isTracking(current.state.doc), changes, authors: changeAuthors(changes), active: trackKey.getState(current.state)?.active ?? null };
      },
    }) ?? EMPTY
  );
}
