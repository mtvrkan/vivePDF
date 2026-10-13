import { BUSINESS_TEMPLATES } from "./business";
import { CARD_TEMPLATES } from "./cards";
import { CERTIFICATE_TEMPLATES } from "./certificates";
import { COVER_TEMPLATES } from "./covers";
import { EDUCATION_TEMPLATES } from "./education";
import { FINISH_CARD_TEMPLATES } from "./finishCards";
import { FLYER_TEMPLATES } from "./flyers";
import { INVITATION_TEMPLATES } from "./invitations";
import type { StudioTemplate, TemplateCategory } from "./kit";
import { LABEL_TEMPLATES } from "./labels";
import { MENU_TEMPLATES } from "./menus";
import { PERSONAL_TEMPLATES } from "./personal";
import { POSTER_TEMPLATES } from "./posters";
import { RESUME_TEMPLATES } from "./resumes";
import { SOCIAL_TEMPLATES } from "./social";

export const TEMPLATE_CATEGORIES: TemplateCategory[] = ["resumes", "certificates", "invitations", "social", "posters", "flyers", "covers", "business", "cards", "menus", "education", "personal", "labels"];

export const STUDIO_TEMPLATES: StudioTemplate[] = [
  ...RESUME_TEMPLATES,
  ...CERTIFICATE_TEMPLATES,
  ...INVITATION_TEMPLATES,
  ...CARD_TEMPLATES,
  ...FINISH_CARD_TEMPLATES,
  ...POSTER_TEMPLATES,
  ...SOCIAL_TEMPLATES,
  ...FLYER_TEMPLATES,
  ...COVER_TEMPLATES,
  ...MENU_TEMPLATES,
  ...BUSINESS_TEMPLATES,
  ...EDUCATION_TEMPLATES,
  ...PERSONAL_TEMPLATES,
  ...LABEL_TEMPLATES,
];

export function studioTemplate(id: string): StudioTemplate | undefined {
  return STUDIO_TEMPLATES.find((template) => template.id === id);
}
