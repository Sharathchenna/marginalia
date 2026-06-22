import type { CiteStyle, Paper } from "../types";

// ---------- formatting a single reference ----------

export function citation(p: Paper | undefined, style: CiteStyle): string {
  if (!p) return "";
  const mono = "JetBrains Mono,monospace";
  // Escape every field that flows from external metadata (arXiv/CrossRef/HF) or
  // user edits before it reaches dangerouslySetInnerHTML — a "<img onerror=…>"
  // in a title/abstract must not execute inside the webview. Keep the <i> tags.
  const title = escapeHtml(p.title);
  const venue = escapeHtml(p.venue);
  const authorsFull = escapeHtml(p.authorsFull || p.authors);
  const authorsShort = escapeHtml(p.authors);
  if (style === "APA") {
    return `${authorsFull} (${p.year}). <i>${title}</i>. ${venue}.`;
  }
  if (style === "MLA") {
    return `${authorsShort.replace(" et al.", ", et al")}. "${title}." <i>${venue}</i>, ${p.year}.`;
  }
  if (style === "Chicago") {
    return `${authorsFull}. ${p.year}. "${title}." <i>${venue}</i>.`;
  }
  return `<span style="font-family:${mono};font-size:12.5px;white-space:pre-wrap;display:block;color:var(--text-1)">${escapeHtml(
    toBibTeX(p),
  )}</span>`;
}

export function citationText(p: Paper | undefined, style: CiteStyle): string {
  if (!p) return "";
  if (style === "BibTeX") return toBibTeX(p);
  return citation(p, style)
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Escape LaTeX-special characters so exported .bib values don't break processors.
function texEscape(s: string): string {
  const map: Record<string, string> = {
    "\\": "\\textbackslash{}",
    "&": "\\&",
    "%": "\\%",
    "$": "\\$",
    "#": "\\#",
    _: "\\_",
    "{": "\\{",
    "}": "\\}",
    "~": "\\textasciitilde{}",
    "^": "\\textasciicircum{}",
  };
  return s.replace(/[\\&%$#_{}~^]/g, (c) => map[c]);
}

function citeKey(p: Paper): string {
  const fam = (p.authors.split(/[\s,&]+/)[0] || "ref").toLowerCase().replace(/[^a-z0-9]/g, "");
  return (fam || "ref") + (p.year || "");
}

// authorsFull is comma-separated full names ("Ashish Vaswani, Noam Shazeer"); BibTeX
// wants " and " between authors.
function bibAuthors(p: Paper): string {
  const full = p.authorsFull || p.authors;
  return (
    full
      .split(/,\s*/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(" and ") || "Unknown"
  );
}

// ---------- export formats ----------

export function toBibTeX(p: Paper, key?: string): string {
  const k = key ?? citeKey(p);
  const isArxiv = !!p.arxiv && p.arxiv !== "—";
  const hasDoi = !!p.doi && p.doi !== "—";
  // Without a stored publication type, infer one: preprints → @misc, things with
  // a DOI → @article, everything else → @inproceedings (the old hardcoded type).
  const type = isArxiv && !hasDoi ? "misc" : hasDoi ? "article" : "inproceedings";
  const venueField = type === "article" ? "journal" : type === "inproceedings" ? "booktitle" : "howpublished";
  const fields: [string, string][] = [
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

export function toRIS(p: Paper): string {
  const tyMap = !!p.arxiv && p.arxiv !== "—" ? "GEN" : !!p.doi && p.doi !== "—" ? "JOUR" : "CONF";
  const lines = [`TY  - ${tyMap}`, `TI  - ${p.title}`];
  (p.authorsFull || p.authors)
    .split(/,\s*/)
    .filter(Boolean)
    .forEach((a) => lines.push(`AU  - ${a.trim()}`));
  lines.push(`PY  - ${p.year}`, `T2  - ${p.venue}`);
  if (p.doi && p.doi !== "—") lines.push(`DO  - ${p.doi}`);
  if (p.abstract) lines.push(`AB  - ${p.abstract}`);
  p.tags.forEach((t) => lines.push(`KW  - ${t}`));
  lines.push("ER  - ");
  return lines.join("\n");
}

// Spreadsheet-style base-26 suffix: 1→a, 26→z, 27→aa, 28→ab … so a 27th+
// collision can't emit non-alphabetic chars ({ | } ~) that break BibTeX keys.
function alphaSuffix(n: number): string {
  let s = "";
  while (n > 0) {
    n--;
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

export function exportLibrary(papers: Paper[], format: "bibtex" | "ris"): string {
  if (format === "ris") return papers.map(toRIS).join("\n\n") + "\n";
  // De-duplicate colliding cite keys (smith2020 → smith2020a / smith2020b …).
  const seen = new Map<string, number>();
  return (
    papers
      .map((p) => {
        const base = citeKey(p);
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        const key = n === 0 ? base : base + alphaSuffix(n);
        return toBibTeX(p, key);
      })
      .join("\n\n") + "\n"
  );
}

// ---------- import (BibTeX + RIS) ----------

function slug(title: string, year: number): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) + "-" + year
  );
}

function familiesToShort(full: string): string {
  const people = full.split(/,\s*/).filter(Boolean);
  const families = people.map((p) => p.trim().split(/\s+/).pop() || p);
  if (families.length === 0) return "Unknown";
  if (families.length === 1) return families[0];
  if (families.length === 2) return `${families[0]} & ${families[1]}`;
  return `${families[0]} et al.`;
}

function blankPaper(): Paper {
  return {
    id: "",
    title: "Untitled",
    authors: "Unknown",
    authorsFull: "",
    year: new Date().getFullYear(),
    venue: "—",
    doi: "—",
    arxiv: "—",
    tags: [],
    read: false,
    fav: false,
    added: "imported",
    addedTs: Date.now(),
    abstract: "",
    notes: "",
    hl: [],
  };
}

function finalize(p: Paper): Paper {
  p.authors = p.authorsFull ? familiesToShort(p.authorsFull) : p.authors;
  p.id = p.arxiv !== "—" ? p.arxiv : p.doi !== "—" ? p.doi : slug(p.title, p.year);
  return p;
}

function applyBibField(p: Paper, authors: string[], key: string, val: string): void {
  if (key === "title") p.title = val;
  else if (key === "author")
    authors.push(...val.split(/\s+and\s+/i).map((s) => s.trim()).filter(Boolean));
  else if (key === "year") p.year = Number(val.match(/\d{4}/)?.[0]) || p.year;
  else if (key === "journal" || key === "booktitle") p.venue = val;
  else if (key === "doi") p.doi = val;
  else if (key === "eprint" || key === "archiveprefix") p.arxiv = val || p.arxiv;
  else if (key === "abstract") p.abstract = val;
}

// Brace-depth-aware BibTeX parser: handles nested braces ("The {BERT} Model"),
// '@' inside field values, and "-quoted values — the cases the old regex dropped.
function parseBibTeX(text: string): Paper[] {
  const out: Paper[] = [];
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf("@", i);
    if (at < 0) break;
    const open = text.indexOf("{", at);
    if (open < 0) break;
    let depth = 0;
    let end = -1;
    for (let j = open; j < text.length; j++) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end < 0) break;
    parseBibEntry(text.slice(open + 1, end), out);
    i = end + 1;
  }
  return out;
}

function parseBibEntry(entry: string, out: Paper[]): void {
  const p = blankPaper();
  const authors: string[] = [];
  let i = entry.indexOf(",");
  if (i < 0) return; // no fields
  i++;
  while (i < entry.length) {
    const eq = entry.indexOf("=", i);
    if (eq < 0) break;
    const name = entry.slice(i, eq).replace(/[\s,]/g, "").toLowerCase();
    let k = eq + 1;
    while (k < entry.length && /\s/.test(entry[k])) k++;
    let val = "";
    if (entry[k] === "{") {
      let depth = 0;
      let j = k;
      for (; j < entry.length; j++) {
        if (entry[j] === "{") depth++;
        else if (entry[j] === "}") {
          depth--;
          if (depth === 0) break;
        }
      }
      val = entry.slice(k + 1, j);
      i = j + 1;
    } else if (entry[k] === '"') {
      let j = k + 1;
      while (j < entry.length && entry[j] !== '"') j++;
      val = entry.slice(k + 1, j);
      i = j + 1;
    } else {
      let j = k;
      while (j < entry.length && entry[j] !== ",") j++;
      val = entry.slice(k, j);
      i = j;
    }
    const comma = entry.indexOf(",", i);
    i = comma < 0 ? entry.length : comma + 1;
    if (name) applyBibField(p, authors, name, val.replace(/[{}]/g, "").replace(/\s+/g, " ").trim());
  }
  p.authorsFull = authors
    .map((a) => {
      const [fam, giv] = a.split(/,\s*/);
      return giv ? `${giv} ${fam}` : a;
    })
    .join(", ");
  out.push(finalize(p));
}

function parseRIS(text: string): Paper[] {
  const out: Paper[] = [];
  let p: Paper | null = null;
  let authors: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z][A-Z0-9])\s{2}-\s?(.*)$/);
    if (!m) continue;
    const [, tag, val] = m;
    if (tag === "TY") {
      p = blankPaper();
      authors = [];
    } else if (!p) continue;
    else if (tag === "TI" || tag === "T1") p.title = val.trim();
    else if (tag === "AU" || tag === "A1") authors.push(val.trim());
    else if (tag === "PY" || tag === "Y1") p.year = Number(val.slice(0, 4)) || p.year;
    else if (tag === "JO" || tag === "T2" || tag === "JF") p.venue = val.trim();
    else if (tag === "DO") p.doi = val.trim();
    else if (tag === "AB" || tag === "N2") p.abstract = val.trim();
    else if (tag === "KW") p.tags.push(val.trim());
    else if (tag === "ER") {
      p.authorsFull = authors
        .map((a) => {
          const [fam, giv] = a.split(/,\s*/);
          return giv ? `${giv} ${fam}` : a;
        })
        .join(", ");
      out.push(finalize(p));
      p = null;
    }
  }
  return out;
}

// Auto-detect and parse a pasted/loaded bibliography (BibTeX or RIS).
export function parseBibliography(text: string): Paper[] {
  const t = text.trim();
  if (!t) return [];
  if (t.startsWith("@")) return parseBibTeX(t);
  if (/^[A-Z][A-Z0-9]\s{2}-/m.test(t)) return parseRIS(t);
  // fall back: try both
  return [...parseBibTeX(t), ...parseRIS(t)];
}
