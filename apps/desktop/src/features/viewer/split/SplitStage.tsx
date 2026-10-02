import { useRef } from "react";
import type { PageColorScheme } from "@/shared/lib/pageColors";
import { useDocumentStore } from "@/shared/store/documentStore";
import { splitViewOf, useSplitViewStore } from "@/shared/store/splitViewStore";
import { PageView } from "../PageView";
import { SplitDivider } from "./SplitDivider";
import { SplitReadPane } from "./SplitReadPane";

export function SplitStage({ documentId, pageColors }: { documentId: string; pageColors: PageColorScheme }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const document = useDocumentStore((state) => state.documents[documentId] ?? null);
  const view = useSplitViewStore((state) => splitViewOf(state, document?.path));
  const split = document && view ? { ...view, path: document.path, password: document.password } : null;
  const template = split ? `minmax(0, ${split.ratio}fr) auto minmax(0, ${1 - split.ratio}fr)` : "minmax(0, 1fr)";

  return (
    <div
      ref={containerRef}
      className="grid h-full min-h-0"
      data-split-layout={split?.layout}
      style={split?.layout === "rows" ? { gridTemplateRows: template, gridTemplateColumns: "minmax(0, 1fr)" } : { gridTemplateColumns: template, gridTemplateRows: "minmax(0, 1fr)" }}
    >
      <div className="min-h-0 min-w-0">
        <PageView documentId={documentId} pageColors={pageColors} />
      </div>
      {split ? (
        <SplitDivider layout={split.layout} ratio={split.ratio} containerRef={containerRef} onRatioChange={(ratio) => useSplitViewStore.getState().setRatio(split.path, ratio)} />
      ) : null}
      {split ? <SplitReadPane primaryId={documentId} path={split.path} password={split.password} pageColors={pageColors} /> : null}
    </div>
  );
}
