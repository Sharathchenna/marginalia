// CSL (Citation Style Language) formatting via citeproc-js. This adds proper
// journal-specific styles (IEEE, Nature, Harvard, AMA, ACM…) on top of the
// hand-rolled APA/MLA/Chicago/BibTeX in citation.ts. citation.ts stays the
// always-available, dependency-free fallback (and keeps the smoke tests green);
// if citeproc ever throws we silently fall back to it.
import CSL, { Engine } from "citeproc";
import type { CiteStyle, Paper } from "../types";
import { citation as legacyHtml, citationText as legacyText, toBibTeX } from "./citation";

import localeEnUS from "../styles/csl/locales-en-US.xml?raw";
import apaCsl from "../styles/csl/apa.csl?raw";
import mlaCsl from "../styles/csl/modern-language-association.csl?raw";
import chicagoCsl from "../styles/csl/chicago-author-date.csl?raw";
import ieeeCsl from "../styles/csl/ieee.csl?raw";
import natureCsl from "../styles/csl/nature.csl?raw";
import harvardCsl from "../styles/csl/harvard-cite-them-right.csl?raw";
import amaCsl from "../styles/csl/american-medical-association.csl?raw";
import acmCsl from "../styles/csl/association-for-computing-machinery.csl?raw";

// Style id → raw CSL XML for every bundled style.
const CSL_XML: Record<string, string> = {
  apa: apaCsl,
  "modern-language-association": mlaCsl,
  "chicago-author-date": chicagoCsl,
  ieee: ieeeCsl,
  nature: natureCsl,
  "harvard-cite-them-right": harvardCsl,
  "american-medical-association": amaCsl,
  "association-for-computing-machinery": acmCsl,
};

// The picker list shown in the cite modal / settings. The legacy values stay so
// existing saved `defaultCite` settings keep working; they render through their
// real CSL definitions when available (falling back to citation.ts otherwise).
export interface StyleOption {
  id: CiteStyle;
  label: string;
}
export const CITE_STYLE_OPTIONS: StyleOption[] = [
  { id: "APA", label: "APA" },
  { id: "MLA", label: "MLA" },
  { id: "Chicago", label: "Chicago" },
  { id: "ieee", label: "IEEE" },
  { id: "nature", label: "Nature" },
  { id: "harvard-cite-them-right", label: "Harvard" },
  { id: "american-medical-association", label: "AMA (medical)" },
  { id: "association-for-computing-machinery", label: "ACM" },
  { id: "BibTeX", label: "BibTeX" },
];

// Map the four legacy labels onto bundled CSL styles so they look professional.
const LEGACY_TO_CSL: Record<string, string> = {
  APA: "apa",
  MLA: "modern-language-association",
  Chicago: "chicago-author-date",
};

function resolveCslId(style: CiteStyle): string | null {
  if (style === "BibTeX") return null;
  if (CSL_XML[style]) return style;
  return LEGACY_TO_CSL[style] ?? null;
}

// ---- Paper → CSL-JSON ----

function splitName(full: string): { family: string; given?: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { family: parts[0] };
  return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(" ") };
}

function cslType(p: Paper): string {
  const isArxiv = !!p.arxiv && p.arxiv !== "—";
  const hasDoi = !!p.doi && p.doi !== "—";
  if (hasDoi) return "article-journal";
  if (isArxiv) return "article"; // preprint
  return "paper-conference";
}

function paperToCsl(p: Paper): Record<string, unknown> {
  const authors = (p.authorsFull || p.authors || "")
    .split(/,\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(splitName);
  const item: Record<string, unknown> = {
    id: p.id || "item",
    type: cslType(p),
    title: p.title,
    author: authors.length ? authors : [{ family: p.authors || "Unknown" }],
  };
  if (p.year) item.issued = { "date-parts": [[p.year]] };
  if (p.venue && p.venue !== "—") item["container-title"] = p.venue;
  if (p.doi && p.doi !== "—") item.DOI = p.doi;
  if (p.arxiv && p.arxiv !== "—") {
    item.number = `arXiv:${p.arxiv}`;
    item.publisher = "arXiv";
  }
  if (p.abstract) item.abstract = p.abstract;
  return item;
}

// ---- engine cache ----

const engineCache = new Map<string, Engine>();
let currentItem: Record<string, unknown> | null = null;

function getEngine(cslId: string): Engine | null {
  const cached = engineCache.get(cslId);
  if (cached) return cached;
  const xml = CSL_XML[cslId];
  if (!xml) return null;
  const sys = {
    retrieveLocale: () => localeEnUS,
    retrieveItem: (id: string) => (currentItem && currentItem.id === id ? currentItem : null),
  };
  try {
    const engine = new CSL.Engine(sys, xml);
    engineCache.set(cslId, engine);
    return engine;
  } catch {
    return null;
  }
}

function renderWith(cslId: string, p: Paper, format: "html" | "text"): string | null {
  const engine = getEngine(cslId);
  if (!engine) return null;
  try {
    currentItem = paperToCsl(p);
    engine.setOutputFormat(format);
    engine.updateItems([String(currentItem.id)]);
    const [, entries] = engine.makeBibliography();
    const out = (entries || []).join("").trim();
    return out || null;
  } catch {
    return null;
  } finally {
    currentItem = null;
  }
}

// ---- public API (used by the cite modal) ----

/** HTML for a single reference in the given style (BibTeX → mono block). */
export function formatHtml(p: Paper | undefined, style: CiteStyle): string {
  if (!p) return "";
  if (style === "BibTeX") return legacyHtml(p, "BibTeX");
  const cslId = resolveCslId(style);
  if (cslId) {
    const html = renderWith(cslId, p, "html");
    if (html) return html;
  }
  return legacyHtml(p, style); // dependency-free fallback
}

/** Plain text for copying. */
export function formatText(p: Paper | undefined, style: CiteStyle): string {
  if (!p) return "";
  if (style === "BibTeX") return toBibTeX(p);
  const cslId = resolveCslId(style);
  if (cslId) {
    const text = renderWith(cslId, p, "text");
    if (text) return text;
  }
  return legacyText(p, style);
}
