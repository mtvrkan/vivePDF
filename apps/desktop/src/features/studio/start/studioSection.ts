import { create } from "zustand";
import type { TemplateFilter } from "../templates/categories";

export const STUDIO_SECTIONS = ["home", "document", "design", "card", "cv", "templates"] as const;
export type StudioSection = (typeof STUDIO_SECTIONS)[number];

type StudioSectionState = {
  section: StudioSection;
  templateFilter: TemplateFilter;
  select: (section: StudioSection, templateFilter?: TemplateFilter) => void;
};

export const useStudioSectionStore = create<StudioSectionState>((set) => ({
  section: "home",
  templateFilter: "all",
  select: (section, templateFilter = "all") => set({ section, templateFilter }),
}));
