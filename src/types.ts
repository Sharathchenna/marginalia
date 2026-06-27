export interface Highlight {
  text: string;
  color: string;
  page: number;
  note: string;
}

export type ReadingStatus = "unread" | "reading" | "done";

/** What a library item is. "paper" = research paper/PDF (the original domain);
 *  "article" = a saved web page (bookmark) or a post pulled from an RSS feed.
 *  Articles reuse every Paper field (tags, collections, highlights, notes, search,
 *  graph, sync) — `kind` just lets the UI present them differently. */
export type ItemKind = "paper" | "article";
/** How an article entered the library: a user-saved clip/bookmark, or an RSS feed post. */
export type ArticleSource = "clip" | "feed";

export interface Paper {
  id: string;
  title: string;
  authors: string; // short form, e.g. "Vaswani et al."
  authorsFull: string;
  year: number;
  venue: string;
  doi: string;
  arxiv: string;
  tags: string[];
  read: boolean;
  fav: boolean;
  added: string; // human label, e.g. "2d ago"
  addedTs: number; // sortable recency score
  abstract: string;
  notes: string;
  hl: Highlight[];
  /** Filename of the PDF within the library folder, once stored locally. */
  file?: string;
  /** AI-generated structured summary (markdown). */
  summary?: string;
  /** Markdown body for PDF-less papers (e.g. a Hugging Face model/dataset card). */
  markdown?: string;
  /** Remote PDF URL (e.g. a PDF hosted directly in a Hugging Face repo). Cached
   *  into the library folder on first open. */
  pdfUrl?: string;
  /** Reading workflow status (defaults derived from `read`). */
  status?: ReadingStatus;
  /** Manual paper-to-paper links (related work), by paper id. */
  related?: string[];
  /** AI-extracted key concepts/methods/named entities — used to connect papers. */
  concepts?: string[];
  /** Cached extracted body text (native only) for full-text search & AI context. */
  fulltext?: string;
  /** Last page viewed in the reader, for resume. */
  lastPage?: number;
  /** Total page count of the PDF, cached on first open — drives reading progress. */
  pages?: number;
  /** Per-highlight flashcards review state, keyed by highlight index. */
  cards?: Record<number, { due: number; ease: number; reps: number }>;
  /** Retraction status (Crossref / Retraction Watch). Present once checked. */
  retracted?: Retraction | null;
  /** Epoch-ms of the last retraction check, so we don't re-query every load. */
  retractionChecked?: number;

  // ----- web articles (bookmark manager + blog reader) -----
  /** Discriminator. Absent on legacy records — inferred via `itemKind()`; the
   *  one-time store migration backfills it. */
  kind?: ItemKind;
  /** Articles only: how it was saved ("clip" = bookmark, "feed" = RSS post). */
  source?: ArticleSource;
  /** Canonical web URL of an article (papers use doi/arxiv instead). */
  url?: string;
  /** Cached site favicon URL (cosmetic; UI falls back to a letter badge). */
  favicon?: string;
  /** Id of the subscribed feed this post came from (`source === "feed"`). */
  feedId?: string;
  /** Article publish date (epoch-ms) — distinct from `addedTs` (date saved). */
  publishedTs?: number;
  /** Estimated read time in minutes (from word count). */
  readingTime?: number;
  /** Read-later archive: kept in the library but removed from the unread inbox. */
  archived?: boolean;
}

/** A subscribed RSS/Atom feed (blog reader). Stored alongside collections in the
 *  repository's key/value store — posts themselves are `article` Papers. */
export interface Feed {
  /** "feed:" + canonical feed URL. */
  id: string;
  /** The RSS/Atom feed URL we poll. */
  url: string;
  /** The site's human URL (for "open site"). */
  siteUrl?: string;
  title: string;
  favicon?: string;
  /** Optional grouping label in the sidebar. */
  folder?: string;
  /** Epoch-ms of the last successful fetch. */
  lastFetched?: number;
  /** Last fetch error message, if the most recent poll failed. */
  lastError?: string;
  /** Conditional-GET caching, so polls are cheap when nothing changed. */
  etag?: string;
  lastModified?: string;
}

/** A retraction/withdrawal notice resolved from Crossref's Retraction Watch data. */
export interface Retraction {
  /** Notice kind: "retraction" | "withdrawal" | "removal" | "correction" … */
  type: string;
  /** Human label for the notice (e.g. "Retraction"). */
  reason: string;
  /** ISO date (or year) of the notice, when known. */
  date: string;
  /** Link to the retraction notice (doi.org/…). */
  url: string;
}

export interface Collection {
  id: string;
  name: string;
  color: string;
  indent: string;
  ids: string[];
}

export type Theme = "light" | "dark";
export type Density = "compact" | "comfortable";
export type ViewMode = "table" | "card";
export type Screen =
  | "dashboard"
  | "library"
  | "reader"
  | "notebook"
  | "graph"
  | "flashcards"
  | "discover"
  | "feeds"
  | "review"
  | "settings"
  | "onboarding";
// 'all' | 'recent' | 'fav' | 'unread' | 'queue' | 'untagged' | 'tag:X' | collection id
// plus web-article filters: 'bookmarks' | 'feeds' | 'feed:<id>'
export type Filter = string;
// Legacy values "APA" | "MLA" | "Chicago" | "BibTeX" remain valid; CSL style ids
// (e.g. "ieee", "nature", "vancouver") are also accepted by the citation engine.
export type CiteStyle = "APA" | "MLA" | "Chicago" | "BibTeX" | (string & {});
export type SortKey = "added" | "year" | "title";
