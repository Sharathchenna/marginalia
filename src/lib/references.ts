// Pull citable references out of a paper's extracted full text. We look in the
// references / bibliography section when we can find it (fewer false positives),
// else the whole document, and collect the DOIs and arXiv ids — the two things
// we can resolve into real library papers. This powers the reader's clickable
// "References" panel.

export interface ParsedRef {
  key: string;
  doi?: string;
  arxiv?: string;
  /** The identifier to show / resolve. */
  label: string;
}

export function extractReferences(text: string): ParsedRef[] {
  if (!text || text.length < 40) return [];
  // Prefer the tail references section if a heading is present.
  const lower = text.toLowerCase();
  const heads = ["\nreferences", "\nbibliography", "\nreferences\n", "references\n"];
  let start = -1;
  for (const h of heads) start = Math.max(start, lower.lastIndexOf(h));
  const region = start > text.length * 0.3 ? text.slice(start) : text;

  const out = new Map<string, ParsedRef>();
  // DOIs (trim trailing prose punctuation).
  for (const m of region.matchAll(/10\.\d{4,9}\/[^\s"<>)\]}]+/g)) {
    const doi = m[0].replace(/[.,;:)\]}>]+$/, "");
    const key = "doi:" + doi.toLowerCase();
    if (!out.has(key)) out.set(key, { key, doi, label: doi });
  }
  // arXiv ids: "arXiv:1234.56789" or "arXiv 1234.5678".
  for (const m of region.matchAll(/arxiv[:\s]\s*(\d{4}\.\d{4,5})(v\d+)?/gi)) {
    const id = m[1];
    const key = "arx:" + id;
    if (!out.has(key)) out.set(key, { key, arxiv: id, label: "arXiv:" + id });
  }
  return [...out.values()].slice(0, 80);
}
