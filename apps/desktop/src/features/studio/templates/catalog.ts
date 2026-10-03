import type { StudioDesign } from "@/types/studio";
import { BUSINESS_TEMPLATES } from "./business";
import { CARD_TEMPLATES } from "./cards";
import { CERTIFICATE_TEMPLATES } from "./certificates";
import { EDUCATION_TEMPLATES } from "./education";
import { INVITATION_TEMPLATES } from "./invitations";
import type { StudioTemplate, TemplateCategory, Translate } from "./kit";
import { LABEL_TEMPLATES } from "./labels";
import { MENU_TEMPLATES } from "./menus";
import { PERSONAL_TEMPLATES } from "./personal";
import { POSTER_TEMPLATES } from "./posters";

export const TEMPLATE_CATEGORIES: TemplateCategory[] = ["certificates", "invitations", "cards", "posters", "menus", "business", "education", "personal", "labels"];

export const STUDIO_TEMPLATES: StudioTemplate[] = [
  ...CERTIFICATE_TEMPLATES,
  ...INVITATION_TEMPLATES,
  ...CARD_TEMPLATES,
  ...POSTER_TEMPLATES,
  ...MENU_TEMPLATES,
  ...BUSINESS_TEMPLATES,
  ...EDUCATION_TEMPLATES,
  ...PERSONAL_TEMPLATES,
  ...LABEL_TEMPLATES,
];

export function studioTemplate(id: string): StudioTemplate | undefined {
  return STUDIO_TEMPLATES.find((template) => template.id === id);
}

export function buildTemplate(template: StudioTemplate, t: Translate, language: string): StudioDesign {
  return template.build({ t, language });
}
