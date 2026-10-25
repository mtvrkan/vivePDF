declare module "citeproc" {
  export type CiteprocItem = { id: string; locator?: string; label?: string; suffix?: string };
  export type CiteprocCitation = { citationID?: string; citationItems: CiteprocItem[]; properties: { noteIndex: number } };
  export type CiteprocSys = { retrieveLocale: (language: string) => string | undefined; retrieveItem: (id: string) => Record<string, unknown> | undefined };
  export type CiteprocBibliographyMeta = { hangingindent?: boolean | number; "second-field-align"?: string | false; entry_ids: string[][] };
  export class Engine {
    constructor(sys: CiteprocSys, style: string, language?: string, forceLanguage?: boolean);
    rebuildProcessorState(citations: CiteprocCitation[], mode?: string, uncited?: string[]): [string, number, string][];
    previewCitationCluster(citation: CiteprocCitation, before: [string, number][], after: [string, number][], mode?: string): string;
    updateItems(ids: string[]): void;
    updateUncitedItems(ids: string[]): void;
    makeBibliography(): [CiteprocBibliographyMeta, string[]] | false;
  }
  const CSL: { Engine: typeof Engine };
  export default CSL;
}
