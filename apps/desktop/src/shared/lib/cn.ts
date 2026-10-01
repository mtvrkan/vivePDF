import { fieldClass } from "./fieldClass";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return fieldClass(...parts);
}
