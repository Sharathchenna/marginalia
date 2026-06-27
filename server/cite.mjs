// Server-side citation formatting — a faithful port of the desktop app's
// `src/lib/citation.ts` (dependency-free APA/MLA/Chicago/BibTeX) + `src/lib/csl.ts`
// (citeproc-js for the journal styles: IEEE, Nature, ACM, AMA, Harvard…). Keeps
// one source of truth for output: the same Paper → string the Mac app produces.
//
// Imported by server.mjs to serve POST /v1/cite for iOS and the web build. The
// CSL XML lives in ./csl/ (copied into the image next to this file).
import CSL from "citeproc";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// In the Docker image the styles are copied to ./csl/; running from the repo they
// live in ../src/styles/csl/. Use whichever exists.
const CSL_DIR = existsSync(join(here, "csl"))
  ? join(here, "csl")
  : join(here, "..", "src", "styles", "csl");

// Style id → CSL filename. Mirrors csl.ts's CSL_XML map.
const CSL_FILES = {
  apa: "apa.csl",
  "modern-language-association": "modern-language-association.csl",
  "chicago-author-date": "chicago-author-date.csl",
  ieee: "ieee.csl",
  nature: "nature.csl",
  "harvard-cite-them-right": "harvard-cite-them-right.csl",
  "american-medical-association": "american-medical-association.csl",
  "association-for-computing-machinery": "association-for-computing-machinery.csl",
};

// The picker list shown in the cite modal / settings (mirrors CITE_STYLE_OPTIONS).
export const CITE_STYLE_OPTIONS = [
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
const LEGACY_TO_CSL = {
  APA: "apa",
  MLA: "modern-language-association",
  Chicago: "chicago-author-date",
};

function resolveCslId(style) {
  if (style === "BibTeX") return null;
  if (CSL_FILES[style]) return style;
  return LEGACY_TO_CSL[style] ?? null;
}

// ---------- dependency-free formatting (port of citation.ts) ----------

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function texEscape(s) {
  const map = {
    "\\": "\\textbackslash{}",
    "&": "\\&",
    "%": "\\%",
    $: "\\$",
    "#": "\\#",
    _: "\\_",
    "{": "\\{",
    "}": "\\}",
    "~": "\\textasciitilde{}",
    "^": "\\textasciicircum{}",
  };
  return String(s ?? "").replace(/[\\&%$#_{}~^]/g, (c) => map[c]);
}

function citeKey(p) {
  const fam = (p.authors.split(/[\s,&]+/)[0] || "ref").toLowerCase().replace(/[^a-z0-9]/g, "");
  return (fam || "ref") + (p.year || "");
}

function bibAuthors(p) {
  const full = p.authorsFull || p.authors;
  return (
    full
      .split(/,\s*/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(" and ") || "Unknown"
  );
}

export function toBibTeX(p, key) {
  const k = key ?? citeKey(p);
  const isArxiv = !!p.arxiv && p.arxiv !== "—";
  const hasDoi = !!p.doi && p.doi !== "—";
  const type = isArxiv && !hasDoi ? "misc" : hasDoi ? "article" : "inproceedings";
  const venueField = type === "article" ? "journal" : type === "inproceedings" ? "booktitle" : "howpublished";
  const fields = [
    ["title", p.title],
    ["author", bibAuthors(p)],
    ["year", String(p.year || "")],
  ];
  if (p.venue && p.venue !== "—") fields.push([venueField, p.venue]);
  if (hasDoi) fields.push(["doi", p.doi]);
  if (isArxiv) {
    fields.push(["eprint", p.arxiv]);
    fields.push(["archivePrefix", "arXiv"]);
  }
  const body = fields
    .filter(([, v]) => v && v.trim())
    .map(([f, v]) => `  ${f.padEnd(13)} = {${texEscape(v)}}`)
    .join(",\n");
  return `@${type}{${k},\n${body}\n}`;
}

function legacyHtml(p, style) {
  if (!p) return "";
  const mono = "JetBrains Mono,monospace";
  const title = escapeHtml(p.title);
  const venue = escapeHtml(p.venue);
  const authorsFull = escapeHtml(p.authorsFull || p.authors);
  const authorsShort = escapeHtml(p.authors);
  if (style === "APA") return `${authorsFull} (${p.year}). <i>${title}</i>. ${venue}.`;
  if (style === "MLA") return `${authorsShort.replace(" et al.", ", et al")}. "${title}." <i>${venue}</i>, ${p.year}.`;
  if (style === "Chicago") return `${authorsFull}. ${p.year}. "${title}." <i>${venue}</i>.`;
  return `<span style="font-family:${mono};font-size:12.5px;white-space:pre-wrap;display:block;color:var(--text-1)">${escapeHtml(
    toBibTeX(p),
  )}</span>`;
}

function legacyText(p, style) {
  if (!p) return "";
  if (style === "BibTeX") return toBibTeX(p);
  return legacyHtml(p, style)
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

// ---------- Paper → CSL-JSON (port of csl.ts) ----------

function splitName(full) {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { family: parts[0] };
  return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(" ") };
}

function cslType(p) {
  const isArxiv = !!p.arxiv && p.arxiv !== "—";
  const hasDoi = !!p.doi && p.doi !== "—";
  if (hasDoi) return "article-journal";
  if (isArxiv) return "article"; // preprint
  return "paper-conference";
}

function paperToCsl(p) {
  const authors = (p.authorsFull || p.authors || "")
    .split(/,\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(splitName);
  const item = {
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

// ---------- citeproc engine cache ----------

let localeXml = null;
function locale() {
  if (localeXml == null) localeXml = readFileSync(join(CSL_DIR, "locales-en-US.xml"), "utf8");
  return localeXml;
}

const xmlCache = new Map();
function styleXml(cslId) {
  if (xmlCache.has(cslId)) return xmlCache.get(cslId);
  const file = CSL_FILES[cslId];
  const xml = file ? readFileSync(join(CSL_DIR, file), "utf8") : null;
  xmlCache.set(cslId, xml);
  return xml;
}

const engineCache = new Map();
let currentItem = null;

function getEngine(cslId) {
  const cached = engineCache.get(cslId);
  if (cached) return cached;
  const xml = styleXml(cslId);
  if (!xml) return null;
  const sys = {
    retrieveLocale: () => locale(),
    retrieveItem: (id) => (currentItem && currentItem.id === id ? currentItem : null),
  };
  try {
    const engine = new CSL.Engine(sys, xml);
    engineCache.set(cslId, engine);
    return engine;
  } catch {
    return null;
  }
}

function renderWith(cslId, p, format) {
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

// ---------- public API ----------

export function formatHtml(p, style) {
  if (!p) return "";
  if (style === "BibTeX") return legacyHtml(p, "BibTeX");
  const cslId = resolveCslId(style);
  if (cslId) {
    const html = renderWith(cslId, p, "html");
    if (html) return html;
  }
  return legacyHtml(p, style);
}

export function formatText(p, style) {
  if (!p) return "";
  if (style === "BibTeX") return toBibTeX(p);
  const cslId = resolveCslId(style);
  if (cslId) {
    const text = renderWith(cslId, p, "text");
    if (text) return text;
  }
  return legacyText(p, style);
}

/** Format one paper into `{ id, text, html }` for the given style. */
export function cite(paper, style) {
  return {
    id: paper?.id ?? null,
    style,
    text: formatText(paper, style),
    html: formatHtml(paper, style),
  };
}
