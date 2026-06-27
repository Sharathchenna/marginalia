import type { Paper } from "../types";
import { invoke, isTauri } from "./tauri";

// Resolve a DOI / arXiv ID / URL into a Paper by querying arXiv or CrossRef.
// In the browser these go through Vite dev-server proxies (to dodge CORS);
// in the native shell they're handled by a Rust command (reqwest).

type Kind =
  | { type: "arxiv"; id: string }
  | { type: "doi"; id: string }
  | { type: "hf"; id: string; hfType: "model" | "dataset" }
  | { type: "pdf"; url: string };

export function classifyIdentifier(raw: string): Kind {
  const s = raw.trim();
  // Hugging Face URLs (checked first — they contain neither a DOI nor an arXiv id)
  if (/huggingface\.co\//i.test(s)) {
    // A PDF file sitting directly in a repo: .../blob|resolve/<rev>/<path>.pdf
    // (blob → resolve gives the raw downloadable file).
    const pdfFile = s.match(/huggingface\.co\/(.+?)\/(?:blob|resolve)\/([^?#]+\.pdf)/i);
    if (pdfFile)
      return { type: "pdf", url: `https://huggingface.co/${pdfFile[1]}/resolve/${pdfFile[2]}` };
    const path = s
      .replace(/^.*huggingface\.co\//i, "")
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "");
    const segs = path.split("/").filter(Boolean);
    // huggingface.co/papers/<arxivId> → the underlying arXiv paper
    if (segs[0] === "papers" && segs[1])
      return { type: "arxiv", id: segs[1].replace(/v\d+$/, "") };
    // huggingface.co/datasets/<id> (id may be "owner/name")
    if (segs[0] === "datasets" && segs[1]) {
      const sub = segs[2] && !["tree", "blob", "resolve"].includes(segs[2]);
      return { type: "hf", id: sub ? `${segs[1]}/${segs[2]}` : segs[1], hfType: "dataset" };
    }
    // huggingface.co/<owner>/<model>
    const reserved = ["models", "spaces", "blog", "docs", "organizations", "settings", "join", "login"];
    if (segs.length >= 2 && !reserved.includes(segs[0]))
      return { type: "hf", id: `${segs[0]}/${segs[1]}`, hfType: "model" };
  }
  // arXiv URL — abs page or direct PDF (e.g. arxiv.org/pdf/2310.06825v2.pdf)
  const arxUrl = s.match(/arxiv\.org\/(?:abs|pdf)\/([^\s?#]+)/i);
  if (arxUrl)
    return { type: "arxiv", id: arxUrl[1].replace(/\.pdf$/i, "").replace(/v\d+$/, "") };
  // arXiv: prefix
  const arxPrefix = s.match(/arxiv:\s*([0-9.]+(v\d+)?)/i);
  if (arxPrefix) return { type: "arxiv", id: arxPrefix[1].replace(/v\d+$/, "") };
  // bare arXiv id (e.g. 1706.03762 or 2310.06825v2)
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(s))
    return { type: "arxiv", id: s.replace(/v\d+$/, "") };
  // legacy bare arXiv id (e.g. hep-th/9901001, math.AG/0309001)
  if (/^[a-z][a-z-]+(\.[A-Z]{2})?\/\d{7}(v\d+)?$/i.test(s))
    return { type: "arxiv", id: s.replace(/v\d+$/, "") };
  // DOI anywhere in the string (incl. doi.org URLs and "10.48550/arXiv...")
  const doi = s.match(/10\.\d{4,9}\/[^\s"<>]+/);
  if (doi) {
    // DOIs pasted from prose pick up trailing punctuation — trim it.
    const id = doi[0].replace(/[.,;:)\]}>]+$/, "");
    // arXiv-minted DOIs map back to the arXiv API for a richer record
    const arxDoi = id.match(/arXiv\.(\d{4}\.\d{4,5})/i);
    if (arxDoi) return { type: "arxiv", id: arxDoi[1] };
    return { type: "doi", id };
  }
  // Any direct PDF URL (HF repo files, lab/personal pages, etc.)
  if (/^https?:\/\/\S+\.pdf(?:[?#]|$)/i.test(s)) return { type: "pdf", url: s };
  throw new Error("Unrecognized identifier — paste a DOI, arXiv ID, or URL.");
}

function shortAuthors(families: string[]): string {
  if (families.length === 0) return "Unknown";
  if (families.length === 1) return families[0];
  if (families.length === 2) return `${families[0]} & ${families[1]}`;
  return `${families[0]} et al.`;
}

function base(paper: Partial<Paper>): Paper {
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
    added: "just now",
    addedTs: Date.now(),
    abstract: "",
    notes: "",
    hl: [],
    ...paper,
  };
}

async function fetchArxiv(id: string): Promise<Paper> {
  const res = await fetch(`/arxiv-api/api/query?id_list=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`arXiv request failed (${res.status})`);
  const xml = new DOMParser().parseFromString(await res.text(), "text/xml");
  const entry = xml.querySelector("entry");
  if (!entry) throw new Error("No arXiv record found for that ID.");
  const text = (sel: string) => entry.querySelector(sel)?.textContent?.trim() ?? "";
  const title = text("title").replace(/\s+/g, " ");
  const families = Array.from(entry.querySelectorAll("author name")).map((n) => {
    const parts = (n.textContent ?? "").trim().split(/\s+/);
    return parts[parts.length - 1] || (n.textContent ?? "").trim();
  });
  const authorsFull = Array.from(entry.querySelectorAll("author name"))
    .map((n) => (n.textContent ?? "").trim())
    .join(", ");
  const published = text("published");
  const year = published ? Number(published.slice(0, 4)) : new Date().getFullYear();
  return base({
    id,
    title,
    authors: shortAuthors(families),
    authorsFull,
    year,
    venue: "arXiv",
    doi: text("arxiv\\:doi") || "—",
    arxiv: id,
    abstract: text("summary").replace(/\s+/g, " "),
  });
}

function stripJats(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchDoi(doi: string): Promise<Paper> {
  const res = await fetch(`/crossref/works/${encodeURIComponent(doi)}`);
  if (!res.ok) throw new Error(`CrossRef request failed (${res.status})`);
  const m = (await res.json()).message;
  const families: string[] = (m.author ?? []).map(
    (a: { family?: string; name?: string }) => a.family ?? a.name ?? "",
  );
  const authorsFull: string = (m.author ?? [])
    .map((a: { given?: string; family?: string; name?: string }) =>
      a.name ?? [a.given, a.family].filter(Boolean).join(" "),
    )
    .join(", ");
  const year =
    m.issued?.["date-parts"]?.[0]?.[0] ??
    m.published?.["date-parts"]?.[0]?.[0] ??
    new Date().getFullYear();
  return base({
    id: doi,
    title: (m.title?.[0] ?? "Untitled").replace(/\s+/g, " "),
    authors: shortAuthors(families.filter(Boolean)),
    authorsFull,
    year,
    venue: m["container-title"]?.[0] ?? m.publisher ?? "—",
    doi,
    arxiv: "—",
    abstract: m.abstract ? stripJats(m.abstract) : "",
  });
}

// HF API/host is CORS-enabled; web dev routes through the Vite proxy to be safe.
const hfHost = () => (isTauri() ? "https://huggingface.co" : "/huggingface");

// arXiv/DOI lookups share one path: native delegates to Rust (reqwest), web hits
// the proxied APIs directly.
async function resolveArxiv(id: string): Promise<Paper> {
  return isTauri() ? invoke<Paper>("lookup_identifier", { identifier: id }) : fetchArxiv(id);
}
async function resolveDoi(id: string): Promise<Paper> {
  return isTauri() ? invoke<Paper>("lookup_identifier", { identifier: id }) : fetchDoi(id);
}

function stripFrontmatter(md: string): string {
  return md.replace(/^\s*---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

/** Build a Paper for a PDF that lives at a URL (HF repo file, lab page, etc.).
 *  The PDF is fetched + cached into the library folder when the reader opens it. */
function paperFromPdfUrl(url: string): Paper {
  const clean = url.split(/[?#]/)[0];
  const fname = clean.split("/").pop() || "document.pdf";
  const title = fname.replace(/\.pdf$/i, "").replace(/[_+]+/g, " ").trim() || "Untitled PDF";
  const hf = clean.match(/huggingface\.co\/(?:datasets\/)?([^/]+)\/[^/]+\/resolve\//i);
  const owner = hf ? hf[1] : "";
  return base({
    id: `pdf:${clean}`,
    title,
    authors: owner || "Unknown",
    authorsFull: owner,
    venue: hf ? "Hugging Face" : "Web",
    doi: "—",
    arxiv: "—",
    pdfUrl: clean,
    notes: url,
  });
}

/** Resolve a Hugging Face model/dataset to a Paper. Prefers the linked arXiv
 *  paper (richest record + PDF); otherwise imports the card README as Markdown. */
async function lookupHuggingFace(id: string, hfType: "model" | "dataset"): Promise<Paper> {
  const cardPrefix = hfType === "dataset" ? `/datasets/${id}` : `/${id}`;
  const apiPath = hfType === "dataset" ? `/api/datasets/${id}` : `/api/models/${id}`;
  let info: {
    tags?: string[];
    cardData?: { pretty_name?: string };
    siblings?: { rfilename?: string }[];
  } | null = null;
  try {
    const res = await fetch(`${hfHost()}${apiPath}`);
    if (res.ok) info = await res.json();
  } catch {
    /* network/CORS — fall through to card import */
  }
  // An `arxiv:<id>` tag points at the real paper — resolve to that (best outcome).
  const arxivTag = (info?.tags ?? []).find((t) => /^arxiv:\d{4}\.\d{4,5}/i.test(t));
  if (arxivTag) {
    const arxId = arxivTag.slice(arxivTag.indexOf(":") + 1).replace(/v\d+$/, "");
    try {
      return await resolveArxiv(arxId);
    } catch {
      /* fall through if the arXiv lookup fails */
    }
  }
  // No linked arXiv paper? If the repo ships a PDF, read that directly.
  const pdfSibling = (info?.siblings ?? [])
    .map((x) => x.rfilename || "")
    .find((f) => /\.pdf$/i.test(f));
  if (pdfSibling)
    return paperFromPdfUrl(`https://huggingface.co${cardPrefix}/resolve/main/${pdfSibling}`);
  // Otherwise import the card README (the "only on HF" case).
  let readme = "";
  try {
    const res = await fetch(`${hfHost()}${cardPrefix}/raw/main/README.md`);
    if (res.ok) readme = await res.text();
  } catch {
    /* gated (401) or missing — leave empty */
  }
  const body = stripFrontmatter(readme);
  const url = `https://huggingface.co${cardPrefix}`;
  const owner = id.split("/")[0] || "Hugging Face";
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const title = info?.cardData?.pretty_name || heading || id;
  const intro = body
    .replace(/^#.*$/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
  return base({
    id: `hf:${id}`,
    title,
    authors: owner,
    authorsFull: owner,
    venue: "Hugging Face",
    doi: "—",
    arxiv: "—",
    abstract: intro || `Hugging Face ${hfType} card — ${url}`,
    notes: url,
    markdown: body
      ? `${body}\n\n---\n\n[View on Hugging Face](${url})`
      : `# ${title}\n\nNo public card content (the ${hfType} may be gated).\n\n[View on Hugging Face](${url})`,
  });
}

/** Build a library item for a plain web page (blog post, docs, lab page) from
 *  just its URL — the browser fallback when we can't fetch the page. */
function webPaperFromUrl(raw: string): Paper {
  const clean = raw.split(/[?#]/)[0];
  let host = "Web";
  let slug = clean;
  try {
    const u = new URL(raw);
    host = u.hostname.replace(/^www\./, "");
    slug = u.pathname.split("/").filter(Boolean).pop() || host;
  } catch {
    /* keep defaults */
  }
  const title =
    slug
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[-_]+/g, " ")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase()) || host;
  return base({
    id: "web:" + clean,
    title,
    authors: host,
    authorsFull: host,
    venue: host,
    notes: raw,
    markdown: `[Open original ↗](${raw})`,
  });
}

// Save an arbitrary web page: native fetches the page for a real title/abstract;
// the browser preview falls back to a URL-derived title (cross-origin fetch is
// blocked there).
async function lookupWebPage(raw: string): Promise<Paper> {
  if (isTauri()) {
    try {
      return await invoke<Paper>("fetch_webpage", { url: raw });
    } catch {
      return webPaperFromUrl(raw);
    }
  }
  return webPaperFromUrl(raw);
}

export async function lookupIdentifier(raw: string): Promise<Paper> {
  let kind: Kind;
  try {
    kind = classifyIdentifier(raw);
  } catch (e) {
    // Not an academic identifier — but if it's a web page, save it as one.
    if (/^https?:\/\/\S+/i.test(raw.trim())) return lookupWebPage(raw.trim());
    throw e;
  }
  if (kind.type === "pdf") return paperFromPdfUrl(kind.url);
  if (kind.type === "hf") return lookupHuggingFace(kind.id, kind.hfType);
  if (kind.type === "arxiv") return resolveArxiv(kind.id);
  return resolveDoi(kind.id);
}
