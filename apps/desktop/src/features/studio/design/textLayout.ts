import { useLayoutEffect, useState, type RefObject } from "react";
import type { StudioRenderBand, StudioTextElement } from "@/types/studio";
import { onlyPositionDiffers, updateElement } from "../model/edit";
import { buildTextNode, fitTextBox, fitTextSize, measureLayout } from "./measure";
import { useStudioStore } from "./studioStore";

function sameBands(left: StudioRenderBand[], right: StudioRenderBand[]): boolean {
  return left.length === right.length && left.every((band, index) => Math.abs(band.x - right[index].x) < 0.01 && Math.abs(band.y - right[index].y) < 0.01 && Math.abs(band.width - right[index].width) < 0.01 && Math.abs(band.height - right[index].height) < 0.01);
}

export function elementBands(element: StudioTextElement, language: string): StudioRenderBand[] {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;contain:layout style";
  document.body.append(host);
  try {
    const { frame, body } = buildTextNode(element, language);
    host.append(frame);
    return measureLayout(frame, element, fitTextSize(body, element)).bands;
  } finally {
    host.remove();
  }
}

function liveBands(frame: HTMLElement, element: StudioTextElement): StudioRenderBand[] {
  const body = frame.querySelector<HTMLElement>("[data-text-body]");
  if (!body || !frame.offsetWidth) return [];
  const scale = frame.getBoundingClientRect().width / frame.offsetWidth || 1;
  return measureLayout(frame, element, parseFloat(body.style.fontSize) || element.fontSize, scale).bands;
}

export function useTextBands(frameRef: RefObject<HTMLDivElement | null>, element: StudioTextElement, language: string, editing: boolean, signature: string): StudioRenderBand[] {
  const [bands, setBands] = useState<StudioRenderBand[]>([]);
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const update = (next: StudioRenderBand[]) => setBands((current) => (sameBands(current, next) ? current : next));
    if (!frame || !element.highlight || (editing && element.rotation % 360 !== 0)) {
      update([]);
      return;
    }
    if (!editing) {
      update(elementBands(element, language));
      return;
    }
    const compute = () => update(liveBands(frame, element));
    compute();
    const observer = new MutationObserver(compute);
    observer.observe(frame, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [frameRef, element, language, editing, signature]);
  return bands;
}

export function useAutoFit(element: StudioTextElement, language: string, editing: boolean, signature: string) {
  useLayoutEffect(() => {
    if (editing || (element.autoSize !== "height" && element.autoSize !== "width")) return;
    const state = useStudioStore.getState();
    if (state.editingId === element.id || !state.design) return;
    for (const page of state.design.pages) {
      const live = page.elements.find((other) => onlyPositionDiffers(other, element));
      if (!live) continue;
      const patch = fitTextBox(live as StudioTextElement, language);
      if (patch) state.preview((design) => ({ ...design, pages: design.pages.map((item) => (item.id === page.id ? updateElement<StudioTextElement>(item, element.id, patch) : item)) }));
      return;
    }
  }, [element, language, editing, signature]);
}
