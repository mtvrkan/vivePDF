import { createContext, useContext } from "react";

export const CvSingleSectionContext = createContext(false);

export function useSingleSection(): boolean {
  return useContext(CvSingleSectionContext);
}
