/// <reference types="vite/client" />

// Raw text imports for bundled CSL styles + locale (Vite `?raw` loader).
declare module "*.csl?raw" {
  const content: string;
  export default content;
}
declare module "*.xml?raw" {
  const content: string;
  export default content;
}

// citeproc-js ships no types; we use a tiny structural subset.
declare module "citeproc" {
  interface EngineSys {
    retrieveLocale: (lang: string) => string;
    retrieveItem: (id: string) => unknown;
  }
  export class Engine {
    constructor(sys: EngineSys, style: string, lang?: string, forceLang?: boolean);
    updateItems(ids: string[]): void;
    makeBibliography(): [unknown, string[]];
    setOutputFormat(format: "html" | "text" | "rtf"): void;
  }
  const CSL: { Engine: typeof Engine; PROCESSOR_VERSION: string };
  export default CSL;
}
