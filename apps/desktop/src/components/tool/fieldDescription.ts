import { createContext, useContext } from "react";

export const FieldDescriptionContext = createContext<string | undefined>(undefined);

export function useFieldDescription(): string | undefined {
  return useContext(FieldDescriptionContext);
}

export const ControlLabelContext = createContext<string | undefined>(undefined);

export function useControlLabel(): string | undefined {
  return useContext(ControlLabelContext);
}
