// RSS/Atom blog reader. Parses a feed (RSS 2.0, RDF/RSS 1.0, or Atom) into
// entries, discovers a feed URL from a site's HTML, and turns each entry into an
// `article` library item. Fetching arbitrary feed hosts is cross-origin, so the
// network round-trip goes through the native `fetch_feed` command (reqwest) — the
// browser dev preview can only reach CORS-enabled feeds and degrades gracefully.
import type { Feed, Paper } from "../types";
import { estimateReadingTime, faviconUrl } from "./items";
import { invoke, isTauri } from "./tauri";

export interface FeedEntry {
  guid: string;
  title: string;
  url: string;
  author: string;
  publishedTs: number; // 0 when unknown
  contentHtml: string; // full body when present, else the summary
  summary: string; // short excerpt (plain-ish)
}

export interface ParsedFeed {
  title: string;
  siteUrl: string;
  entries: FeedEntry[];
}

export interface FetchResult {
  status: number;
  body: string;
  etag?: string;
  lastModified?: string;
}

/** Canonical feed id from a feed URL (strips the fragment). */
export function feedIdFor(url: string): string {
  return "feed:" + url.trim().replace(/#.*$/, "");
}

/** Heuristic: does this body look like an XML feed rather than an HTML page? */
export function looksLikeFeed(body: string): boolean {
  const head = body.slice(0, 800).toLowerCase();
  return /<rss[\s>]|<feed[\s>]|<rdf:rdf|<\?xml/.test(head) && !/<html[\s>]/.test(head);
}

// Fetch raw feed/page text. Native uses reqwest (conditional GET); browser dev
// attempts a direct fetch (works only for CORS-enabled hosts).
export async function fetchFeed(
  url: string,
  etag?: string,
  lastModified?: string,
): Promise<FetchResult> {
  if (isTauri()) {
    return invoke<FetchResult>("fetch_feed", {
      url,
      etag: etag ?? "",
      since: lastModified ?? "",
    });
  }
  const res = await fetch(url);
  return {
    status: res.status,
    body: await res.text(),
    etag: res.headers.get("etag") ?? undefined,
    lastModified: res.headers.get("last-modified") ?? undefined,
  };
}

// First child element whose local or qualified name matches one of `names`.
function child(el: Element, ...names: string[]): Element | null {
  const want = names.map((n) => n.toLowerCase());
  for (const node of Array.from(el.children)) {
    const ln = (node.localName || node.nodeName).toLowerCase();
    const qn = node.nodeName.toLowerCase();
    if (want.includes(ln) || want.includes(qn)) return node;
  }
  return null;
}

function childText(el: Element, ...names: string[]): string {
  return (child(el, ...names)?.textContent ?? "").trim();
}

// Parse a date string (RFC-822 for RSS, ISO-8601 for Atom). 0 when unparseable.
function parseDate(s: string): number {
  if (!s) return 0;
  const t = Date.parse(s.trim());
  return Number.isFinite(t) ? t : 0;
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse feed XML into a normalized shape. Throws on unparseable XML. */
export function parseFeed(xml: string, feedUrl: string): ParsedFeed {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Couldn't parse this feed.");
  const root = doc.documentElement;
  const rootName = (root.localName || root.nodeName).toLowerCase();
  const isAtom = rootName === "feed";

  if (isAtom) {
    const siteUrl =
      atomLink(root, "alternate") || atomLink(root, "") || feedUrl;
    const title = childText(root, "title") || siteUrl;
    const entries = Array.from(root.getElementsByTagName("entry")).map((e): FeedEntry => {
      const url = atomLink(e, "alternate") || atomLink(e, "");
      const contentHtml = childText(e, "content");
      const summary = childText(e, "summary");
      return {
        guid: childText(e, "id") || url,
        title: stripHtml(childText(e, "title")) || "(untitled)",
        url,
        author: childText(child(e, "author") ?? e, "name"),
        publishedTs: parseDate(childText(e, "published", "updated", "issued")),
        contentHtml: contentHtml || summary,
        summary: stripHtml(summary || contentHtml).slice(0, 600),
      };
    });
    return { title: stripHtml(title), siteUrl, entries };
  }

  // RSS 2.0 / RDF (RSS 1.0): items live under <channel> (RSS2) or at root (RDF).
  const channel = doc.querySelector("channel") || root;
  const title = childText(channel, "title") || feedUrl;
  const siteUrl = childText(channel, "link") || feedUrl;
  const items = Array.from(doc.getElementsByTagName("item"));
  const entries = items.map((it): FeedEntry => {
    const link = childText(it, "link") || childText(it, "guid");
    const contentHtml = childText(it, "content:encoded", "encoded") || childText(it, "description");
    const summary = childText(it, "description");
    return {
      guid: childText(it, "guid") || link,
      title: stripHtml(childText(it, "title")) || "(untitled)",
      url: link,
      author: childText(it, "dc:creator", "creator", "author"),
      publishedTs: parseDate(childText(it, "pubDate", "dc:date", "date", "published")),
      contentHtml,
      summary: stripHtml(summary || contentHtml).slice(0, 600),
    };
  });
  return { title: stripHtml(title), siteUrl, entries };
}

// Atom <link> href for a given rel (empty rel = first link without rel="self").
function atomLink(el: Element, rel: string): string {
  for (const node of Array.from(el.children)) {
    if ((node.localName || node.nodeName).toLowerCase() !== "link") continue;
    const r = (node.getAttribute("rel") || "").toLowerCase();
    if (rel ? r === rel : r !== "self") {
      const href = node.getAttribute("href");
      if (href) return href;
    }
  }
  return "";
}

/** Find a feed URL advertised in a page's HTML (`<link rel=alternate>`). "" if none. */
export function discoverFeedUrl(html: string, baseUrl: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const links = Array.from(doc.querySelectorAll('link[rel~="alternate"], link[rel="feed"]'));
  const feed = links.find((l) => /rss|atom|xml/i.test(l.getAttribute("type") || "") || l.getAttribute("rel") === "feed");
  const href = feed?.getAttribute("href");
  if (!href) return "";
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

// ---- OPML (the portable subscription-list format every feed reader speaks) ----

function xmlEscape(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Serialize subscribed feeds to OPML (grouped by folder when present). */
export function feedsToOPML(feeds: Feed[]): string {
  const line = (f: Feed, indent: string) =>
    `${indent}<outline type="rss" text="${xmlEscape(f.title)}" title="${xmlEscape(f.title)}" xmlUrl="${xmlEscape(f.url)}"${
      f.siteUrl ? ` htmlUrl="${xmlEscape(f.siteUrl)}"` : ""
    }/>`;
  const byFolder = new Map<string, Feed[]>();
  for (const f of feeds) {
    const k = f.folder?.trim() || "";
    (byFolder.get(k) ?? byFolder.set(k, []).get(k)!).push(f);
  }
  const body: string[] = [];
  for (const [folder, list] of byFolder) {
    if (folder) {
      body.push(`    <outline text="${xmlEscape(folder)}" title="${xmlEscape(folder)}">`);
      body.push(...list.map((f) => line(f, "      ")));
      body.push("    </outline>");
    } else {
      body.push(...list.map((f) => line(f, "    ")));
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="1.0">\n  <head><title>Marginalia feeds</title></head>\n  <body>\n${body.join("\n")}\n  </body>\n</opml>\n`;
}

/** Extract feed URLs (xmlUrl) from an OPML document. */
export function opmlToUrls(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return Array.from(doc.querySelectorAll("outline[xmlUrl]"))
    .map((o) => o.getAttribute("xmlUrl") || "")
    .filter(Boolean);
}

/** Hostname (no www.) for an entry/feed, falling back to the feed title. */
function hostOf(entry: FeedEntry, feed: Feed): string {
  for (const u of [entry.url, feed.siteUrl, feed.url]) {
    if (!u) continue;
    try {
      return new URL(u).hostname.replace(/^www\./, "");
    } catch {
      /* next */
    }
  }
  return feed.title;
}

/** Turn a feed entry into an `article` library item (stable id from its guid). */
export function entryToArticle(entry: FeedEntry, feed: Feed): Paper {
  const host = hostOf(entry, feed);
  const body = entry.contentHtml || entry.summary || "";
  const md = body
    ? `${body}\n\n---\n\n[Read on ${host} ↗](${entry.url})`
    : `[Read the full post on ${host} ↗](${entry.url})`;
  return {
    id: "feed:" + (entry.guid || entry.url),
    kind: "article",
    source: "feed",
    feedId: feed.id,
    title: entry.title,
    authors: entry.author || feed.title,
    authorsFull: entry.author || "",
    year: entry.publishedTs ? new Date(entry.publishedTs).getFullYear() : 0,
    venue: feed.title,
    doi: "—",
    arxiv: "—",
    tags: [],
    read: false,
    fav: false,
    added: "just now",
    addedTs: Date.now(),
    publishedTs: entry.publishedTs || undefined,
    abstract: entry.summary,
    notes: entry.url,
    url: entry.url,
    favicon: faviconUrl(host),
    readingTime: estimateReadingTime(body),
    hl: [],
    markdown: md,
  };
}

/** Resolve a site-or-feed URL to its feed + first parse. Throws with a friendly
 *  message on failure. Used when the user subscribes. */
export async function resolveFeed(rawUrl: string): Promise<{ feed: Feed; entries: FeedEntry[] }> {
  const input = rawUrl.trim();
  if (!/^https?:\/\//i.test(input)) throw new Error("Enter a full http(s) URL.");
  const first = await fetchFeed(input);
  if (first.status >= 400) throw new Error(`Couldn't fetch that URL (${first.status}).`);

  let feedUrl = input;
  let body = first.body;
  let etag = first.etag;
  let lastModified = first.lastModified;

  if (!looksLikeFeed(body)) {
    const discovered = discoverFeedUrl(body, input);
    if (!discovered) throw new Error("No RSS/Atom feed found on that page.");
    feedUrl = discovered;
    const res = await fetchFeed(discovered);
    if (res.status >= 400 || !looksLikeFeed(res.body))
      throw new Error("Found a feed link, but couldn't load the feed.");
    body = res.body;
    etag = res.etag;
    lastModified = res.lastModified;
  }

  const parsed = parseFeed(body, feedUrl);
  let host = feedUrl;
  try {
    host = new URL(parsed.siteUrl || feedUrl).hostname.replace(/^www\./, "");
  } catch {
    /* keep */
  }
  const feed: Feed = {
    id: feedIdFor(feedUrl),
    url: feedUrl,
    siteUrl: parsed.siteUrl,
    title: parsed.title || host,
    favicon: faviconUrl(host),
    lastFetched: Date.now(),
    etag,
    lastModified,
  };
  return { feed, entries: parsed.entries };
}
