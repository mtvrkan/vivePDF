import { Award, BookOpen, Briefcase, CalendarHeart, Contact, GraduationCap, IdCard, MailOpen, Megaphone, Newspaper, Share2, Tag, UtensilsCrossed, type LucideIcon } from "lucide-react";
import type { TemplateCategory } from "./kit";

export type TemplateFilter = TemplateCategory | "all";

export const TEMPLATE_CATEGORIES: TemplateCategory[] = ["resumes", "certificates", "invitations", "social", "posters", "flyers", "covers", "business", "cards", "menus", "education", "personal", "labels"];

export const CATEGORY_ICONS: Record<TemplateCategory, LucideIcon> = {
  resumes: IdCard,
  certificates: Award,
  invitations: MailOpen,
  social: Share2,
  posters: Megaphone,
  flyers: Newspaper,
  covers: BookOpen,
  business: Briefcase,
  cards: Contact,
  menus: UtensilsCrossed,
  education: GraduationCap,
  personal: CalendarHeart,
  labels: Tag,
};
