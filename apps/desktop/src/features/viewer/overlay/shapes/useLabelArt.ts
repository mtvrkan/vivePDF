import { useEffect, useState } from "react";
import type { TypesetResult } from "../formula/mathjaxEngine";
import type { LabelArt } from "./render";

type Engine = { typeset: (latex: string) => Promise<TypesetResult> };
type EngineState = { status: "loading" } | { status: "ready"; engine: Engine } | { status: "failed" };

const MAX_CACHED_LABELS = 400;
const labelCache = new Map<string, LabelArt>();

async function typesetLabels(engine: Engine, latexList: string[]): Promise<void> {
  for (const latex of latexList) {
    if (labelCache.has(latex)) continue;
    const result = await engine.typeset(latex);
    if (!("svg" in result)) continue;
    if (labelCache.size >= MAX_CACHED_LABELS) {
      const oldest = labelCache.keys().next().value;
      if (oldest !== undefined) labelCache.delete(oldest);
    }
    labelCache.set(latex, result);
  }
}

export function useLabelArt(latexList: string[]) {
  const [engineState, setEngineState] = useState<EngineState>({ status: "loading" });
  const [, setLabelsVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    import("../formula/mathjaxEngine").then(
      (engine) => {
        if (!cancelled) setEngineState({ status: "ready", engine });
      },
      () => {
        if (!cancelled) setEngineState({ status: "failed" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const engine = engineState.status === "ready" ? engineState.engine : null;

  useEffect(() => {
    if (!engine || latexList.every((latex) => labelCache.has(latex))) return;
    let cancelled = false;
    void typesetLabels(engine, latexList).then(() => {
      if (!cancelled) setLabelsVersion((value) => value + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [engine, latexList]);

  const settle = async () => {
    if (engine && latexList.length > 0) await typesetLabels(engine, latexList);
  };

  return { labels: labelCache, status: engineState.status, settle };
}
