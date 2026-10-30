import { createContext } from "preact";
import { useContext } from "preact/hooks";
import { createTranslator, type Translate } from "../i18n";

export const TranslateContext = createContext<Translate>(createTranslator("en"));

export function useT(): Translate {
  return useContext(TranslateContext);
}
