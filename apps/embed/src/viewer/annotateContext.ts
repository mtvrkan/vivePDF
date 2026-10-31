import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { Lang } from "../i18n";

export type AnnotateModule = typeof import("../annotate/annotate");

export type AnnotateKit = { module: AnnotateModule; lang: Lang };

export const AnnotateContext = createContext<AnnotateKit | null>(null);

export function useAnnotateKit(): AnnotateKit | null {
  return useContext(AnnotateContext);
}

export function loadAnnotate(): Promise<AnnotateModule> {
  return import("../annotate/annotate");
}
