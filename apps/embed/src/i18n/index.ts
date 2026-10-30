import en from "./en.json";
import tr from "./tr.json";
import type { Lang } from "./lang";

export type { Lang } from "./lang";
export type MessageKey = keyof typeof en;
export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

const MESSAGES: Record<Lang, Record<MessageKey, string>> = { tr, en };

export function createTranslator(lang: Lang): Translate {
  const messages = MESSAGES[lang];
  return (key, vars) => {
    const text = messages[key];
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
  };
}
