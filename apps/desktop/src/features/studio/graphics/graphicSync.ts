import { create } from "zustand";
import { toRpcError } from "@/shared/rpc/client";
import { chartPreview, flowchartPreview, tablePreview } from "@/shared/rpc/operations";
import type { RpcError } from "@/types";
import type { StudioDesign, StudioElement, StudioGraphicSpec, StudioSvgElement } from "@/types/studio";
import { useStudioStore } from "../design/studioStore";
import { graphicJob, withRendered, type GraphicJob, type RenderedGraphic } from "./graphicData";

export const SYNC_DELAY_MS = 180;

export type GraphicStatus = { state: "rendering"; key: string } | { state: "error"; key: string; error: RpcError };

type GraphicStatusState = { status: Record<string, GraphicStatus>; set: (id: string, status: GraphicStatus | null) => void };

export const useGraphicStatus = create<GraphicStatusState>((set) => ({
  status: {},
  set: (id, status) =>
    set((state) => {
      const next = { ...state.status };
      if (status) next[id] = status;
      else delete next[id];
      return { status: next };
    }),
}));

export function renderGraphic(graphic: StudioGraphicSpec): Promise<RenderedGraphic> {
  switch (graphic.kind) {
    case "table":
      return tablePreview(graphic.spec);
    case "chart":
      return chartPreview(graphic.spec);
    case "flowchart":
      return flowchartPreview(graphic.spec);
  }
}

function findElement(design: StudioDesign, id: string): StudioElement | null {
  for (const page of design.pages) {
    const found = page.elements.find((element) => element.id === id);
    if (found) return found;
  }
  return null;
}

export function applyRendered(design: StudioDesign, job: GraphicJob, result: RenderedGraphic): StudioDesign {
  const element = findElement(design, job.id);
  if (!element || element.kind !== "svg" || graphicJob(element)?.key !== job.key) return design;
  const next = withRendered(element as StudioSvgElement, job, result);
  return {
    ...design,
    pages: design.pages.map((page) => (page.elements.includes(element) ? { ...page, elements: page.elements.map((item) => (item === element ? next : item)) } : page)),
  };
}

export function pendingJobs(design: StudioDesign): GraphicJob[] {
  const jobs: GraphicJob[] = [];
  for (const page of design.pages) {
    for (const element of page.elements) {
      const job = graphicJob(element);
      if (job) jobs.push(job);
    }
  }
  return jobs;
}

const running = new Map<string, string>();

function runJob(job: GraphicJob) {
  const status = useGraphicStatus.getState();
  running.set(job.id, job.key);
  status.set(job.id, { state: "rendering", key: job.key });
  renderGraphic(job.graphic)
    .then((result) => {
      if (running.get(job.id) !== job.key) return;
      running.delete(job.id);
      useGraphicStatus.getState().set(job.id, null);
      useStudioStore.getState().preview((design) => applyRendered(design, job, result));
    })
    .catch((error: unknown) => {
      if (running.get(job.id) !== job.key) return;
      running.delete(job.id);
      useGraphicStatus.getState().set(job.id, { state: "error", key: job.key, error: toRpcError(error) });
    });
}

export function syncGraphics() {
  const design = useStudioStore.getState().design;
  if (!design) return;
  const failed = useGraphicStatus.getState().status;
  for (const job of pendingJobs(design)) {
    if (running.get(job.id) === job.key) continue;
    const known = failed[job.id];
    if (known?.state === "error" && known.key === job.key) continue;
    runJob(job);
  }
}

export function retryGraphic(id: string) {
  useGraphicStatus.getState().set(id, null);
  running.delete(id);
  syncGraphics();
}

export function startGraphicSync(delay = SYNC_DELAY_MS): () => void {
  let timer = 0;
  const unsubscribe = useStudioStore.subscribe((state, previous) => {
    if (state.design === previous.design) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(syncGraphics, delay);
  });
  syncGraphics();
  return () => {
    unsubscribe();
    window.clearTimeout(timer);
    running.clear();
    useGraphicStatus.setState({ status: {} });
  };
}
