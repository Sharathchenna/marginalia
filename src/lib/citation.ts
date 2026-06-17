import type { CiteStyle, Paper } from "../types";

// ---------- formatting a single reference ----------

export function citation(p: Paper | undefined, style: CiteStyle): string {
  if (!p) return "";
  const mono = "JetBrains Mono,monospace";
  if (style === "APA") {
    return `${p.authorsFull || p.authors} (${p.year}). <i>${p.title}</i>. ${p.venue}.`;
  }
  if (style === "MLA") {
    return `${p.authors.replace(" et al.", ", et al")}. "${p.title}." <i>${p.venue}</i>, ${p.year}.`;
  }
  if (style === "Chicago") {
    return `${p.authorsFull || p.authors}. ${p.year}. "${p.title}." <i>${p.venue}</i>.`;
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
    .trim();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function citeKey(p: Paper): string {
  return (p.authors.split(/[\s,&]+/)[0] || "ref").toLowerCase() + p.year;
}

// ---------- export formats ----------

export function toBibTeX(p: Paper): string {
  const fields: [string, string][] = [
    ["title", p.title],
    ["author", p.authorsFull || p.authors],
    ["year", String(p.year)],
    ["booktitle", p.venue],
  ];
  if (p.doi && p.doi !== "—") fields.push(["doi", p.doi]);
  if (p.arxiv && p.arxiv !== "—") fields.push(["eprint", p.arxiv]);
  const body = fields
    .map(([k, v]) => `  ${k.padEnd(9)} = {${v}}`)
    .join(",\n");
  return `@inproceedings{${citeKey(p)},\n${body}\n}`;
}

export function toRIS(p: Paper): string {
  const lines = ["TY  - CONF", `TI  - ${p.title}`];
  (p.authorsFull || p.authors)
    .split(/,\s*/)
    .filter(Boolean)
    .forEach((a) => lines.push(`AU  - ${a}`));
  lines.push(`PY  - ${p.year}`, `T2  - ${p.venue}`);
  if (p.doi && p.doi !== "—") lines.push(`DO  - ${p.doi}`);
  if (p.abstract) lines.push(`AB  - ${p.abstract}`);
  p.tags.forEach((t) => lines.push(`KW  - ${t}`));
  lines.push("ER  - ");
  return lines.join("\n");
}

export function exportLibrary(papers: Paper[], format: "bibtex" | "ris"): string {
  const fn = format === "bibtex" ? toBibTeX : toRIS;
  return papers.map(fn).join("\n\n") + "\n";
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
    addedTs: 225,
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

function parseBibTeX(text: string): Paper[] {
  const out: Paper[] = [];
  const entries = text.match(/@\w+\s*\{[^@]*\}/gs) ?? [];
  for (const entry of entries) {
    const p = blankPaper();
    const authors: string[] = [];
    const fieldRe = /(\w+)\s*=\s*(\{([^{}]*)\}|"([^"]*)"|(\d+))/g;
    let m: RegExpExecArray | null;
    while ((m = fieldRe.exec(entry))) {
      const key = m[1].toLowerCase();
      const val = (m[3] ?? m[4] ?? m[5] ?? "").replace(/\s+/g, " ").trim();
      if (key === "title") p.title = val;
      else if (key === "author") authors.push(...val.split(/\s+and\s+/i));
      else if (key === "year") p.year = Number(val) || p.year;
      else if (key === "journal" || key === "booktitle") p.venue = val;
      else if (key === "doi") p.doi = val;
      else if (key === "eprint" || key === "archiveprefix") p.arxiv = val || p.arxiv;
      else if (key === "abstract") p.abstract = val;
    }
    // BibTeX authors are usually "Family, Given" or "Given Family"
    p.authorsFull = authors
      .map((a) => {
        const [fam, giv] = a.split(/,\s*/);
        return giv ? `${giv} ${fam}` : a;
      })
      .join(", ");
    out.push(finalize(p));
  }
  return out;
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
