import { Fragment, type CSSProperties, type ReactNode } from "react";
import type { BlockRun as Run } from "@/shared/store/viewerOverlayStore";
import { runStyleAttr, styleOf } from "./runs";

export type RunStyler = (run: Run) => CSSProperties;

export function renderRuns(runs: Run[], runStyle: RunStyler): ReactNode[] {
  return runs.map((run, index) => {
    const parts = run.text.split("\n");
    return (
      <span key={index} data-run-style={runStyleAttr(styleOf(run))} style={runStyle(run)}>
        {parts.map((part, partIndex) => (
          <Fragment key={partIndex}>
            {partIndex > 0 ? <br /> : null}
            {part}
          </Fragment>
        ))}
      </span>
    );
  });
}
