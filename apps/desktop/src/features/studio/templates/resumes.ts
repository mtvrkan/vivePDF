import { isLocale } from "@/app/locales";
import { CV_LAYOUT_IDS, defaultTheme, sampleProfile, type CvLayoutId } from "../cv/cvModel";
import { sampleCv } from "../cv/cvSample";
import type { StudioTemplate } from "./kit";

export function resumeTemplateId(layout: CvLayoutId): string {
  return `resume${layout.charAt(0).toUpperCase()}${layout.slice(1)}`;
}

export const RESUME_TEMPLATES: StudioTemplate[] = CV_LAYOUT_IDS.map((layout) => ({
  id: resumeTemplateId(layout),
  category: "resumes",
  size: "a4",
  build: ({ t, language }) => sampleCv(sampleProfile(t), { ...defaultTheme(isLocale(language) ? language : "en"), layout }, t, t(`studio.templates.items.${resumeTemplateId(layout)}`)),
}));
