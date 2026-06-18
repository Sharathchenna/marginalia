export interface Highlight {
  text: string;
  color: string;
  page: number;
  note: string;
}

export type ReadingStatus = "unread" | "reading" | "done";

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
  /** Per-highlight flashcards review state, keyed by highlight index. */
  cards?: Record<number, { due: number; ease: number; reps: number }>;
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
  | "settings"
  | "onboarding";
export type Filter = string; // 'all' | 'recent' | 'fav' | 'unread' | 'tag:X' | collection id
export type CiteStyle = "APA" | "MLA" | "Chicago" | "BibTeX";
export type SortKey = "added" | "year" | "title";
