// Helpers for the unified library item model. A library record (`Paper`) is
// either a research "paper" or a web "article" (a saved bookmark or an RSS feed
// post). These derive an item's kind/source and the article-flavored metadata
// the bookmark manager + blog reader present, working on legacy records too (the
// store backfills `kind` once on load — see `migrateKinds`).
import type { ArticleSource, ItemKind, Paper } from "../types";

/** Resolve an item's kind, inferring it for legacy records that predate `kind`. */
export function itemKind(p: Paper): ItemKind {
  if (p.kind) return p.kind;
  // Web clips / HF cards used `web:` / `hf:` ids; PDF-less markdown items with no
  // academic identifier are articles too.
  const webId = /^(web:|hf:|feed:)/.test(p.id);
  const noAcademicId = (!p.arxiv || p.arxiv === "—") && (!p.doi || p.doi === "—");
  const markdownOnly = !!p.markdown && !p.file && noAcademicId;
  return webId || markdownOnly ? "article" : "paper";
}

export function isArticle(p: Paper): boolean {
  return itemKind(p) === "article";
}

/** A saved web article (bookmark), as opposed to an RSS feed post. These drive
 *  the read-later inbox: finishing one archives it out of the Bookmarks view. */
export function isBookmark(p: Paper): boolean {
  return isArticle(p) && itemSource(p) !== "feed";
}

/** Where an article came from. Feed posts carry `source`/`feedId`; older clips
 *  are treated as "clip" (manual bookmarks). */
export function itemSource(p: Paper): ArticleSource {
  if (p.source) return p.source;
  return p.feedId ? "feed" : "clip";
}

/** The original web URL for an article — explicit `url`, else recovered from the
 *  clip's `notes`/id (older records stored it there). "" for papers. */
export function articleUrl(p: Paper): string {
  if (p.url) return p.url;
  if (p.notes && /^https?:\/\//i.test(p.notes.trim())) return p.notes.trim();
  if (p.id.startsWith("web:")) return p.id.slice(4);
  return "";
}

/** Bare hostname (no leading www.) for an article, falling back to venue. */
export function articleHost(p: Paper): string {
  const u = articleUrl(p);
  if (u) {
    try {
      return new URL(u).hostname.replace(/^www\./, "");
    } catch {
      /* fall through */
    }
  }
  return p.venue && p.venue !== "—" ? p.venue : "Web";
}

/** A favicon URL for a host (DuckDuckGo's privacy-friendly icon proxy). Empty for
 *  unknown hosts so the UI shows a letter badge instead. */
export function faviconUrl(host: string): string {
  if (!host || host === "Web" || !host.includes(".")) return "";
  return `https://icons.duckduckgo.com/ip3/${host}.ico`;
}

const WORDS_PER_MIN = 220;

/** Estimate read time (minutes) from an article body (Markdown or HTML). */
export function estimateReadingTime(body?: string): number {
  if (!body) return 0;
  const words = body
    .replace(/<[^>]+>/g, " ")
    .replace(/[#>*_`~\-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return words ? Math.max(1, Math.round(words / WORDS_PER_MIN)) : 0;
}
