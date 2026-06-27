import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CiteStyle,
  Collection,
  Density,
  Feed,
  Filter,
  Paper,
  Screen,
  SortKey,
  Theme,
  ViewMode,
} from "./types";
import { repo, type Settings } from "./lib/repo";
import {
  articleUrl,
  estimateReadingTime,
  faviconUrl,
  isArticle,
  isBookmark,
  itemKind,
  itemSource,
} from "./lib/items";
import {
  entryToArticle,
  feedsToOPML,
  fetchFeed,
  opmlToUrls,
  parseFeed,
  resolveFeed,
  type FeedEntry,
} from "./lib/feeds";
import { decryptJson, encryptJson, isEncrypted } from "./lib/crypto";
import { invoke, isMobilePlatform, isTauri, detectGlassPlatform } from "./lib/tauri";
import {
  chooseLibraryFolder,
  ensureLocalPdfPath,
  importPdf,
  pickPdfFiles,
  scanLibrary,
} from "./lib/library";
import type { ScannedPdf } from "./lib/library";
import { lookupIdentifier } from "./lib/metadata";
import { assessLibrary, autoTag as agentAutoTag, extractMetadata, summarizePaper, setAgentModel, setAgentBackend } from "./lib/agent";
import type { AssessResult, AssessTask, AutoTagResult } from "./lib/agent";
import { exportLibrary as exportLibraryMd, exportPaper as exportPaperMd } from "./lib/markdown";
import { exportLibrary as exportBibLibrary, parseBibliography } from "./lib/citation";
import { checkRetraction } from "./lib/retraction";
import { findDuplicates, mergePapers, type DuplicateGroup } from "./lib/dedupe";
import { hitToPaper, recommendFromLibrary, type DiscoverHit } from "./lib/discover";
import { retrieveForChat, searchPapers } from "./lib/search";
import {
  buildEmbedText,
  embedPapers,
  embeddingStatus,
  semanticSearch,
  similarPapers as similarPapersCmd,
  type EmbedStatus,
} from "./lib/embeddings";

// Native window-material the current platform supports (computed once).
const GLASS_PLATFORM = detectGlassPlatform();

export type ToastKind = "info" | "success" | "error";

// In-app dialog (replaces window.prompt/confirm, which are no-ops in the Tauri
// webview). One modal renders either a text prompt or a yes/no confirm.
export type DialogState =
  | { kind: "prompt"; title: string; value: string; placeholder?: string; confirmLabel: string }
  | { kind: "confirm"; title: string; body?: string; confirmLabel: string; danger?: boolean };

// Trigger a browser download of an object as pretty-printed JSON.
function downloadJson(name: string, data: unknown): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// Trigger a browser download of arbitrary text (OPML export, etc.).
function downloadText(name: string, text: string, type = "text/plain"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// How recent counts as "Recently Added" (also drives the recent filter/count).
const RECENT_MS = 21 * 86400000;
// addedTs below this is a legacy 0-255 "recency rank" (pre-timestamp seed data),
// not an epoch-ms timestamp.
const LEGACY_TS_MAX = 1e11;

// One-time migration: convert legacy rank-based addedTs to real epoch-ms while
// preserving order, so "date added" sort, the recent filter, and relative-time
// labels all work. Newest legacy paper lands ~1 day ago; older ones trail back.
function migrateAddedTs(papers: Paper[]): { papers: Paper[]; changed: boolean } {
  const ranks = papers.filter((p) => p.addedTs < LEGACY_TS_MAX).map((p) => p.addedTs);
  if (!ranks.length) return { papers, changed: false };
  const DAY = 86400000;
  const maxRank = Math.max(...ranks);
  const base = Date.now() - DAY;
  const next = papers.map((p) =>
    p.addedTs < LEGACY_TS_MAX ? { ...p, addedTs: base - (maxRank - p.addedTs) * DAY } : p,
  );
  return { papers: next, changed: true };
}

// One-time backfill: stamp `kind` on every record (and, for articles, derive
// url/readingTime if missing) so the bookmark/blog UI can branch on it without
// re-inferring on every render. Pure — returns updated papers + a changed flag.
function migrateKinds(papers: Paper[]): { papers: Paper[]; changed: boolean } {
  let changed = false;
  const next = papers.map((p) => {
    if (p.kind) return p;
    changed = true;
    const kind = itemKind(p);
    const patch: Partial<Paper> = { kind };
    if (kind === "article") {
      if (!p.url) {
        const u = articleUrl(p);
        if (u) patch.url = u;
      }
      if (p.readingTime == null && p.markdown) {
        const rt = estimateReadingTime(p.markdown);
        if (rt) patch.readingTime = rt;
      }
    }
    return { ...p, ...patch };
  });
  return { papers: next, changed };
}

// Parse a Pocket export (ril_export.html) — a flat list of <a href time_added tags>
// links — into bookmark seeds. Pocket exports carry no article body, so these
// import as link bookmarks (open original / re-clip for full text).
function parsePocketHtml(html: string): { url: string; title: string; tags: string[]; addedTs: number }[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll("a[href]"))
    .map((a) => ({
      url: a.getAttribute("href") || "",
      title: (a.textContent || "").trim(),
      tags: (a.getAttribute("tags") || "").split(",").map((t) => t.trim()).filter(Boolean),
      addedTs: Number(a.getAttribute("time_added") || 0) * 1000 || 0,
    }))
    .filter((x) => /^https?:\/\//i.test(x.url));
}

type CardState = NonNullable<Paper["cards"]>[number];
// When highlight `removed` is deleted, shift every card keyed by a higher index
// down by one (and drop the deleted one) so SRS state stays attached to the
// right highlight.
function reindexCards(cards: Record<number, CardState>, removed: number): Record<number, CardState> {
  const next: Record<number, CardState> = {};
  for (const [k, v] of Object.entries(cards)) {
    const i = Number(k);
    if (i === removed) continue;
    next[i > removed ? i - 1 : i] = v;
  }
  return next;
}

const SORT_LABEL: Record<SortKey, string> = {
  added: "Date added",
  year: "Year",
  title: "Title",
};
const FILTER_TITLE: Record<string, string> = {
  all: "All Papers",
  recent: "Recently Added",
  fav: "Favorites",
  unread: "Unread",
  queue: "Inbox",
  untagged: "Untagged",
  articles: "All Articles",
  bookmarks: "Bookmarks",
  feeds: "Blog Feeds",
  archived: "Archive",
};
// The noun shown next to the count in the list header, per filter.
const FILTER_NOUN: Record<string, string> = {
  bookmarks: "bookmark",
  feeds: "post",
  articles: "article",
  archived: "item",
};

// Fill in authors/venue/year from an auto-tag result, but only when the paper is
// currently missing them (never overwrite good existing data).
function enrich(patch: Partial<Paper>, p: Paper, m: AutoTagResult): void {
  const missingAuthors = !p.authorsFull || !p.authors || p.authors === "Unknown";
  if (missingAuthors && m.authorsShort && m.authorsShort !== "—") patch.authors = m.authorsShort;
  if (!p.authorsFull && m.authorsFull && m.authorsFull !== "—") patch.authorsFull = m.authorsFull;
  const yr = Number(m.year);
  if (!p.year && yr) patch.year = yr;
  const badVenue = !p.venue || p.venue === "—" || p.venue === "Local PDF" || p.venue === "Imported PDF";
  if (badVenue && m.venue && m.venue !== "—") patch.venue = m.venue;
}

const COLLECTION_COLORS = ["#4B57D6", "#2E9E6B", "#E0A23A", "#C0395E", "#7C84FF"];

// File a paper into the collection matching `category` (case-insensitive),
// creating the collection if none exists yet. Pure — returns updated collections,
// so it can be folded over a batch before a single persist. `seq` keeps generated
// ids unique within one synchronous batch (Date.now() alone can collide).
function fileInCategory(cols: Collection[], category: string, paperId: string, seq = 0): Collection[] {
  const name = category.trim();
  if (!name) return cols;
  const idx = cols.findIndex((c) => c.name.toLowerCase() === name.toLowerCase());
  if (idx >= 0) {
    const c = cols[idx];
    if (c.ids.includes(paperId)) return cols;
    const next = cols.slice();
    next[idx] = { ...c, ids: [...c.ids, paperId] };
    return next;
  }
  const id = "col-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString(36) + seq;
  return [
    ...cols,
    { id, name, color: COLLECTION_COLORS[cols.length % COLLECTION_COLORS.length], indent: "0", ids: [paperId] },
  ];
}

// A library record for a PDF discovered on disk (title = filename for now).
function filePaper(f: ScannedPdf): Paper {
  return {
    id: "file:" + f.rel,
    title: f.name,
    authors: "Unknown",
    authorsFull: "",
    year: 0,
    venue: "Local PDF",
    doi: "—",
    arxiv: "—",
    tags: [],
    read: false,
    fav: false,
    added: "in library",
    addedTs: 226,
    abstract: "",
    notes: "",
    hl: [],
    file: f.rel,
  };
}

export function useStore() {
  const r = repo();

  // ----- persisted data -----
  const [papers, setPapers] = useState<Paper[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [loaded, setLoaded] = useState(false);

  // ----- settings (persisted) -----
  const [theme, setThemeState] = useState<Theme>("light");
  const [density, setDensityState] = useState<Density>("compact");
  const [view, setViewState] = useState<ViewMode>("table");
  const [defaultCite, setDefaultCite] = useState<CiteStyle>("APA");
  const [libraryLocation, setLibraryLocation] = useState("~/Documents/Papers");
  const [watchFolders, setWatchFolders] = useState<string[]>([]);
  const [librarySet, setLibrarySet] = useState(true);
  // Translucent (real OS glass) interface; default on where the platform supports it.
  const [glass, setGlassState] = useState(GLASS_PLATFORM !== "off");
  // Model for all AI actions ("" = SDK/account default).
  const [model, setModelState] = useState("");
  // Semantic search (Voyage embeddings).
  const [embedProvider, setEmbedProviderState] = useState("off");
  const [embedModel, setEmbedModelState] = useState("voyage-3.5-lite");
  const [voyageKey, setVoyageKeyState] = useState("");
  // Read aloud (text-to-speech).
  const [ttsProvider, setTtsProviderState] = useState("edge");
  const [ttsVoice, setTtsVoiceState] = useState("en-US-AriaNeural");
  const [ttsRate, setTtsRateState] = useState(1.0);
  const [embedStatus, setEmbedStatus] = useState<EmbedStatus>({ embedded: 0, model: "", hasKey: false });
  const [indexing, setIndexing] = useState(false);
  // Keep <library>/library.bib in sync with the library (LaTeX/Overleaf users).
  const [autoBib, setAutoBibState] = useState(false);
  // Duplicate-detection modal.
  const [dupOpen, setDupOpen] = useState(false);
  // Localhost port the native web-capture listener bound to (0 = web / unbound).
  const [capturePort, setCapturePort] = useState(0);
  // "Papers you should read" — Semantic Scholar recommendations from the library.
  const [recs, setRecs] = useState<DiscoverHit[]>([]);
  const [recsLoading, setRecsLoading] = useState(false);
  const [recsError, setRecsError] = useState("");
  // Optional user-hosted WebDAV sync.
  const [webdavUrl, setWebdavUrlState] = useState("");
  const [webdavUser, setWebdavUserState] = useState("");
  const [webdavPass, setWebdavPassState] = useState("");
  const [syncPassphrase, setSyncPassphraseState] = useState("");
  const [syncAuto, setSyncAutoState] = useState(false);
  const [lastSyncTs, setLastSyncTs] = useState(0);
  // Optional self-hosted AI backend (enables AI on iOS/web).
  const [apiUrl, setApiUrlState] = useState("");
  const [apiToken, setApiTokenState] = useState("");
  const [syncing, setSyncing] = useState(false);
  // Claim verification / review screening modal.
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimTask, setClaimTask] = useState<AssessTask>("verify");
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState("");
  const [claimResult, setClaimResult] = useState<AssessResult | null>(null);

  // ----- transient UI state -----
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string>("attention");
  const [sel, setSel] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("added");
  const [sidebar, setSidebar] = useState(true);
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [annOpen, setAnnOpen] = useState(true);
  const [hl, setHl] = useState<string>("#FBE38E");
  const [readerId, setReaderId] = useState<string>("attention");
  const [palette, setPalette] = useState(false);
  const [q, setQ] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [idOpen, setIdOpen] = useState(false);
  const [idText, setIdText] = useState("");
  const [idBusy, setIdBusy] = useState(false);
  const [idError, setIdError] = useState("");
  const [citeOpen, setCiteOpen] = useState(false);
  const [citeStyle, setCiteStyle] = useState<CiteStyle>("APA");
  const [toast, setToast] = useState("");
  const [toastKind, setToastKind] = useState<ToastKind>("success");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const dialogResolve = useRef<((r: string | boolean | null) => void) | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Responsive layout: switch to the single-column mobile shell on a narrow
  // viewport (real iOS/Android, or a narrowed desktop window).
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 760,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setNarrow(window.innerWidth < 760);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // On narrow viewports the sidebar is an off-canvas drawer (this flag), separate
  // from the desktop inline-sidebar toggle (`sidebar`).
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatScope, setChatScope] = useState<"paper" | "library">("paper");
  const [chatSeed, setChatSeed] = useState("");
  const [chatSelection, setChatSelection] = useState("");
  const [aiBusyId, setAiBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [discoverSeed, setDiscoverSeed] = useState("");

  // hydrate from the repository on first mount
  useEffect(() => {
    let alive = true;
    (async () => {
      const [ps, cs, fs, st] = await Promise.all([
        r.listPapers(),
        r.listCollections(),
        r.listFeeds(),
        r.getSettings(),
      ]);
      if (!alive) return;
      const mig = migrateAddedTs(ps);
      const mig2 = migrateKinds(mig.papers);
      setPapers(mig2.papers);
      if (mig.changed || mig2.changed) void r.replacePapers(mig2.papers);
      setCollections(cs);
      setFeeds(fs);
      setThemeState(st.theme);
      setDensityState(st.density);
      setViewState(st.view);
      setDefaultCite(st.defaultCite);
      setCiteStyle(st.defaultCite);
      setLibraryLocation(st.libraryLocation);
      setWatchFolders(st.watchFolders);
      setLibrarySet(st.librarySet);
      if (typeof st.glass === "boolean") setGlassState(st.glass);
      if (typeof st.model === "string") {
        setModelState(st.model);
        setAgentModel(st.model);
      }
      if (typeof st.embedProvider === "string") setEmbedProviderState(st.embedProvider);
      if (typeof st.embedModel === "string") setEmbedModelState(st.embedModel);
      if (typeof st.voyageKey === "string") setVoyageKeyState(st.voyageKey);
      if (typeof st.ttsProvider === "string") setTtsProviderState(st.ttsProvider);
      if (typeof st.ttsVoice === "string") setTtsVoiceState(st.ttsVoice);
      if (typeof st.ttsRate === "number") setTtsRateState(st.ttsRate);
      if (typeof st.autoBib === "boolean") setAutoBibState(st.autoBib);
      if (typeof st.webdavUrl === "string") setWebdavUrlState(st.webdavUrl);
      if (typeof st.webdavUser === "string") setWebdavUserState(st.webdavUser);
      if (typeof st.webdavPass === "string") setWebdavPassState(st.webdavPass);
      if (typeof st.syncPassphrase === "string") setSyncPassphraseState(st.syncPassphrase);
      if (typeof st.syncAuto === "boolean") setSyncAutoState(st.syncAuto);
      if (typeof st.lastSyncTs === "number") setLastSyncTs(st.lastSyncTs);
      if (typeof st.apiUrl === "string" || typeof st.apiToken === "string") {
        const u = typeof st.apiUrl === "string" ? st.apiUrl : "";
        const tk = typeof st.apiToken === "string" ? st.apiToken : "";
        setApiUrlState(u);
        setApiTokenState(tk);
        setAgentBackend(u, tk);
      }
      void embeddingStatus().then(setEmbedStatus);
      if (isTauri()) void invoke<number>("capture_port").then(setCapturePort).catch(() => {});
      if (ps.length && !ps.some((p) => p.id === "attention")) {
        setSelectedId(ps[0].id);
        setReaderId(ps[0].id);
      }
      // first run in the native app: ask for a library folder
      if (isTauri() && !st.librarySet) setScreen("onboarding");
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [r]);

  const showToast = useCallback((msg: string, kind: ToastKind = "success") => {
    setToast(msg);
    setToastKind(kind);
  }, []);

  // In-app prompt/confirm — return a Promise resolved when the user submits or
  // cancels the DialogModal. (window.prompt/confirm are no-ops in the webview.)
  const requestPrompt = useCallback(
    (opts: { title: string; value?: string; placeholder?: string; confirmLabel?: string }) =>
      new Promise<string | null>((resolve) => {
        dialogResolve.current = resolve as (r: string | boolean | null) => void;
        setDialog({
          kind: "prompt",
          title: opts.title,
          value: opts.value ?? "",
          placeholder: opts.placeholder,
          confirmLabel: opts.confirmLabel ?? "OK",
        });
      }),
    [],
  );
  const requestConfirm = useCallback(
    (opts: { title: string; body?: string; confirmLabel?: string; danger?: boolean }) =>
      new Promise<boolean>((resolve) => {
        dialogResolve.current = resolve as (r: string | boolean | null) => void;
        setDialog({
          kind: "confirm",
          title: opts.title,
          body: opts.body,
          confirmLabel: opts.confirmLabel ?? "OK",
          danger: opts.danger,
        });
      }),
    [],
  );
  const closeDialog = useCallback((result: string | boolean | null) => {
    const r = dialogResolve.current;
    dialogResolve.current = null;
    setDialog(null);
    if (r) r(result);
  }, []);
  useEffect(() => {
    if (!toast) return;
    // errors linger a little longer so they're actually readable
    const t = setTimeout(() => setToast(""), toastKind === "error" ? 4000 : 2200);
    return () => clearTimeout(t);
  }, [toast, toastKind]);

  // Persistence writes are fire-and-forget for snappy optimistic UI, but a
  // backend failure (disk full, poisoned mutex, serialization) must not vanish
  // silently — surface it so the user knows the change may not have saved.
  const track = useCallback(
    (p: Promise<unknown> | void, msg = "Couldn't save — your change may not persist") => {
      void Promise.resolve(p).catch(() => showToast(msg, "error"));
    },
    [showToast],
  );

  const persistSettings = useCallback(
    (patch: Partial<Settings>) => {
      track(r.saveSettings(patch));
    },
    [r, track],
  );

  // Mirror the theme to localStorage so the pre-paint <head> script can apply it
  // before React mounts (no dark-mode flash), even on the native SQLite backend.
  useEffect(() => {
    try {
      localStorage.setItem("marg.theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const closeOverlays = useCallback(() => {
    setPalette(false);
    setImportOpen(false);
    setIdOpen(false);
    setCiteOpen(false);
    setShortcutsOpen(false);
  }, []);

  const filtered = useMemo(() => {
    const effStatus = (p: Paper) => p.status ?? (p.read ? "done" : "unread");
    let list = papers;
    if (filter === "all") list = papers;
    else if (filter === "recent") list = papers.filter((p) => Date.now() - p.addedTs <= RECENT_MS);
    else if (filter === "fav") list = papers.filter((p) => p.fav);
    else if (filter === "unread") list = papers.filter((p) => !p.read && !p.archived);
    else if (filter === "untagged") list = papers.filter((p) => p.tags.length === 0);
    else if (filter === "queue") list = papers.filter((p) => effStatus(p) !== "done" && !p.archived);
    // ---- web articles: bookmark manager + blog reader ----
    else if (filter === "articles") list = papers.filter((p) => isArticle(p) && !p.archived);
    else if (filter === "bookmarks")
      list = papers.filter((p) => isArticle(p) && itemSource(p) !== "feed" && !p.archived);
    else if (filter === "feeds")
      list = papers.filter((p) => isArticle(p) && itemSource(p) === "feed" && !p.archived);
    else if (filter === "archived") list = papers.filter((p) => p.archived);
    else if (filter.startsWith("feed:")) {
      const id = filter.slice(5);
      list = papers.filter((p) => p.feedId === id && !p.archived);
    } else if (filter.startsWith("tag:")) {
      const t = filter.slice(4);
      list = papers.filter((p) => p.tags.includes(t));
    } else {
      const c = collections.find((c) => c.id === filter);
      if (c) list = papers.filter((p) => c.ids.includes(p.id));
    }
    const sorted = [...list].sort((a, b) =>
      sortKey === "added"
        ? b.addedTs - a.addedTs
        : sortKey === "year"
          ? b.year - a.year
          : a.title.localeCompare(b.title),
    );
    if (filter === "queue") {
      // Unified triage inbox: unread first, then newest — across papers, bookmarks
      // and feed posts alike. (Currently-reading items surface via "Continue reading".)
      sorted.sort(
        (a, b) =>
          (a.read ? 1 : 0) - (b.read ? 1 : 0) || (b.publishedTs ?? b.addedTs) - (a.publishedTs ?? a.addedTs),
      );
    }
    // Feed/blog views read like a river of news: unread first, newest post first.
    if (filter === "feeds" || filter.startsWith("feed:")) {
      sorted.sort(
        (a, b) =>
          (a.read ? 1 : 0) - (b.read ? 1 : 0) ||
          (b.publishedTs ?? b.addedTs) - (a.publishedTs ?? a.addedTs),
      );
    }
    return sorted;
  }, [papers, collections, filter, sortKey]);

  const moveSel = useCallback(
    (d: number) => {
      if (!filtered.length) return;
      let i = filtered.findIndex((p) => p.id === selectedId);
      i = Math.max(0, Math.min(filtered.length - 1, (i < 0 ? 0 : i) + d));
      setSelectedId(filtered[i].id);
    },
    [filtered, selectedId],
  );

  // The item to land on after `id` leaves the current view (archived/deleted):
  // the next one down, else the previous. Used for one-after-another reading.
  const neighborInView = (id: string): string | undefined => {
    const idx = filtered.findIndex((p) => p.id === id);
    const rest = filtered.filter((p) => p.id !== id);
    return (rest[Math.min(idx, rest.length - 1)] ?? rest[0])?.id;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      const inField =
        !!tgt && (/^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName) || tgt.isContentEditable);
      const anyOverlay = palette || importOpen || idOpen || citeOpen || chatOpen || !!dialog;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n" && !inField) {
        e.preventDefault();
        setIdText("");
        setIdError("");
        setIdOpen(true);
      } else if (e.key === "?" && !inField && !anyOverlay) {
        e.preventDefault();
        setShortcutsOpen(true);
      } else if (e.key === "Escape") {
        closeOverlays();
      } else if (
        screen === "library" &&
        !anyOverlay &&
        !inField &&
        (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "j" || e.key === "k")
      ) {
        // j/k (and arrows) move the selection through the list, Reeder-style.
        e.preventDefault();
        moveSel(e.key === "ArrowDown" || e.key === "j" ? 1 : -1);
      } else if (
        screen === "library" &&
        !anyOverlay &&
        !inField &&
        (e.key === "Enter" || e.key === "o") &&
        selectedId
      ) {
        // Enter / o opens the selected item in the reader.
        e.preventDefault();
        setReaderId(selectedId);
        setScreen("reader");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [screen, palette, importOpen, idOpen, citeOpen, chatOpen, moveSel, closeOverlays, selectedId, dialog]);

  // ----- mutations (write-through to the repo) -----
  const patchPaper = useCallback(
    (id: string, patch: Partial<Paper>) => {
      setPapers((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
      track(r.updatePaper(id, patch));
    },
    [r, track],
  );
  const toggleStar = useCallback(
    (id: string) => {
      const p = papers.find((x) => x.id === id);
      if (p) patchPaper(id, { fav: !p.fav });
    },
    [papers, patchPaper],
  );
  const toggleRead = useCallback(
    (id: string) => {
      const p = papers.find((x) => x.id === id);
      if (p) {
        const read = !p.read;
        // keep status in sync so Unread / Reading-Queue never disagree
        const patch: Partial<Paper> = { read, status: read ? "done" : "unread" };
        // Read-later: finishing a bookmark archives it out of the inbox (so the
        // Bookmarks list only shows what's left to read); un-reading restores it.
        if (isBookmark(p)) patch.archived = read;
        patchPaper(id, patch);
        showToast(
          read ? (isBookmark(p) ? "Archived ✓" : "Marked read") : "Marked unread",
          "info",
        );
      }
    },
    [papers, patchPaper, showToast],
  );

  const addPaper = useCallback(
    (p: Paper) => {
      setPapers((ps) => [p, ...ps.filter((x) => x.id !== p.id)]);
      track(r.addPaper(p));
    },
    [r, track],
  );

  // Resolve a captured page URL (from the bookmarklet) into a library paper,
  // reusing the same lookup pipeline as "Add by identifier".
  const captureUrl = useCallback(
    async (raw: string) => {
      const url = (raw || "").trim();
      if (!url) return;
      try {
        const paper = await lookupIdentifier(url);
        const existing = await r.listPapers();
        if (existing.some((p) => p.id === paper.id)) {
          showToast("Already in your library", "info");
          return;
        }
        addPaper(paper);
        setSelectedId(paper.id);
        showToast(`Captured “${paper.title.slice(0, 40)}…” ✨`);
        if (paper.doi && paper.doi !== "—") {
          void checkRetraction(paper.doi).then((rt) => {
            patchPaper(paper.id, { retracted: rt ?? null, retractionChecked: Date.now() });
            if (rt) showToast(`⚠ Captured paper has a ${rt.reason.toLowerCase()} notice`, "error");
          });
        }
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Couldn't capture that page", "error");
      }
    },
    [r, addPaper, patchPaper, showToast],
  );

  // Save a page the extension clipped to Markdown (full rendered content) as a
  // library item that opens in the Markdown reader.
  const captureClip = useCallback(
    async (data: {
      url?: string;
      title?: string;
      author?: string;
      siteName?: string;
      excerpt?: string;
      markdown?: string;
    }) => {
      const url = (data?.url || "").trim();
      if (!url) return;
      const clean = url.split(/[?#]/)[0];
      const id = "web:" + clean;
      let host = "Web";
      try {
        host = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        /* keep default */
      }
      const md = data.markdown
        ? `${data.markdown}\n\n---\n\n[Original ↗](${url})`
        : `[Open original ↗](${url})`;
      const title = data.title || host;
      const readingTime = estimateReadingTime(data.markdown) || undefined;
      const existing = await r.listPapers();
      if (existing.some((p) => p.id === id)) {
        patchPaper(id, {
          markdown: md,
          title,
          abstract: data.excerpt || "",
          kind: "article",
          source: "clip",
          url: clean,
          readingTime,
          archived: false,
        });
        setSelectedId(id);
        showToast(`Updated clip “${title.slice(0, 36)}”`);
        return;
      }
      addPaper({
        id,
        kind: "article",
        source: "clip",
        title,
        authors: data.author || data.siteName || host,
        authorsFull: data.author || "",
        year: 0,
        venue: data.siteName || host,
        doi: "—",
        arxiv: "—",
        tags: [],
        read: false,
        fav: false,
        added: "just now",
        addedTs: Date.now(),
        abstract: data.excerpt || "",
        notes: url,
        url: clean,
        favicon: faviconUrl(host),
        readingTime,
        hl: [],
        markdown: md,
      });
      setSelectedId(id);
      showToast(`Clipped “${title.slice(0, 36)}” ✨`);
    },
    [r, addPaper, patchPaper, showToast],
  );

  // ---- blog reader: RSS ingestion ----
  // Add a feed's new posts (dedup by id) as `article` items. `firstSync` caps how
  // far back we import so subscribing to a large archive doesn't flood the library.
  const ingestEntries = useCallback(
    async (feed: Feed, entries: FeedEntry[], firstSync: boolean): Promise<number> => {
      if (!entries.length) return 0;
      const current = await r.listPapers();
      const have = new Set(current.map((p) => p.id));
      const fresh = (firstSync ? entries.slice(0, 30) : entries)
        .map((e) => entryToArticle(e, feed))
        .filter((p) => !have.has(p.id));
      if (!fresh.length) return 0;
      // distinct, ordered creation timestamps so "date added" sort stays stable
      const t0 = Date.now();
      fresh.forEach((p, i) => (p.addedTs = t0 + i));
      for (const p of fresh) await r.addPaper(p);
      setPapers((prev) => {
        const ids = new Set(prev.map((x) => x.id));
        return [...fresh.filter((p) => !ids.has(p.id)), ...prev];
      });
      return fresh.length;
    },
    [r],
  );

  // Poll one feed with a conditional GET and ingest new posts. `update` records the
  // feed's refreshed cache headers / lastFetched / lastError. Returns posts added.
  const pollFeed = useCallback(
    async (feed: Feed, update: (patch: Partial<Feed>) => void): Promise<number> => {
      try {
        const res = await fetchFeed(feed.url, feed.etag, feed.lastModified);
        if (res.status === 304) {
          update({ lastFetched: Date.now(), lastError: undefined });
          return 0;
        }
        if (res.status >= 400 || !res.body.trim()) throw new Error(`HTTP ${res.status || "error"}`);
        const parsed = parseFeed(res.body, feed.url);
        const added = await ingestEntries(feed, parsed.entries, false);
        update({
          lastFetched: Date.now(),
          etag: res.etag,
          lastModified: res.lastModified,
          lastError: undefined,
        });
        return added;
      } catch (e) {
        update({ lastFetched: Date.now(), lastError: e instanceof Error ? e.message : "fetch failed" });
        return 0;
      }
    },
    [ingestEntries],
  );

  // Subscribe to a site-or-feed URL: resolve the feed, store it, import its posts.
  // `silent` (used by bulk OPML import) suppresses navigation + per-feed toasts and
  // returns the number of posts imported (null on failure).
  const subscribeFeed = useCallback(
    async (rawUrl: string, opts?: { silent?: boolean }): Promise<number | null> => {
      const url = (rawUrl || "").trim();
      if (!url) return null;
      if (!opts?.silent) showToast("Subscribing…", "info");
      try {
        const { feed, entries } = await resolveFeed(url);
        setFeeds((prev) => {
          const exists = prev.some((f) => f.id === feed.id);
          const next = exists
            ? prev.map((f) => (f.id === feed.id ? { ...feed, folder: f.folder } : f))
            : [...prev, feed];
          track(r.saveFeeds(next));
          return next;
        });
        const added = await ingestEntries(feed, entries, true);
        if (!opts?.silent) {
          setFilter("feed:" + feed.id);
          setScreen("library");
          showToast(`Subscribed to “${feed.title}” · ${added} post${added === 1 ? "" : "s"} ✨`);
        }
        return added;
      } catch (e) {
        if (!opts?.silent) showToast(e instanceof Error ? e.message : "Couldn't subscribe to that feed", "error");
        return null;
      }
    },
    [r, ingestEntries, showToast, track],
  );

  // Refresh every subscribed feed (manual button + the background interval).
  const refreshAllFeeds = useCallback(
    async (silent = false): Promise<number> => {
      const list = await r.listFeeds();
      if (!list.length) {
        if (!silent) showToast("No feeds subscribed yet");
        return 0;
      }
      let total = 0;
      const patches: Record<string, Partial<Feed>> = {};
      for (const feed of list) {
        total += await pollFeed(feed, (patch) => (patches[feed.id] = patch));
      }
      setFeeds((prev) => {
        const next = prev.map((f) => (patches[f.id] ? { ...f, ...patches[f.id] } : f));
        track(r.saveFeeds(next));
        return next;
      });
      if (!silent) showToast(total ? `${total} new post${total === 1 ? "" : "s"} ✨` : "Feeds up to date");
      return total;
    },
    [r, pollFeed, showToast, track],
  );

  // Refresh a single feed by id.
  const refreshFeed = useCallback(
    async (id: string) => {
      const feed = (await r.listFeeds()).find((f) => f.id === id);
      if (!feed) return;
      const added = await pollFeed(feed, (patch) => {
        setFeeds((prev) => {
          const next = prev.map((f) => (f.id === id ? { ...f, ...patch } : f));
          track(r.saveFeeds(next));
          return next;
        });
      });
      showToast(added ? `“${feed.title}”: ${added} new post${added === 1 ? "" : "s"}` : `“${feed.title}” up to date`);
    },
    [r, pollFeed, showToast, track],
  );

  // Scan a folder (recursively) for PDFs and add any not already in the library.
  const scanInto = useCallback(
    async (dir: string): Promise<number> => {
      const found = await scanLibrary(dir);
      const current = await r.listPapers();
      const existing = new Set(current.map((p) => p.id));
      const additions = found
        .filter((f) => !existing.has("file:" + f.rel))
        .map(filePaper);
      // distinct, ordered creation timestamps so "date added" sort is stable
      const t0 = Date.now();
      additions.forEach((a, i) => (a.addedTs = t0 + i));
      for (const p of additions) await r.addPaper(p);
      if (additions.length) {
        setPapers((prev) => {
          const ids = new Set(prev.map((p) => p.id));
          return [...additions.filter((a) => !ids.has(a.id)), ...prev];
        });
      }
      return additions.length;
    },
    [r],
  );

  // On native launch, sync the chosen library folder once (picks up PDFs added
  // outside the app, including those in subfolders).
  const didSync = useRef(false);
  useEffect(() => {
    if (!loaded || didSync.current) return;
    if (isTauri() && librarySet && libraryLocation) {
      didSync.current = true;
      void scanInto(libraryLocation);
    }
  }, [loaded, librarySet, libraryLocation, scanInto]);

  // native only: watch folders for new PDFs and import them live into the
  // library (copy into the library folder + add a paper), not just toast.
  useEffect(() => {
    if (!loaded || !isTauri()) return;
    let alive = true;
    let unlisten = () => {};
    void invoke("start_watch", { folders: watchFolders }).catch(() => {});
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<string>("watch-import", (e) => {
          void (async () => {
            try {
              const file = await importPdf(e.payload, libraryLocation);
              const id = "file:" + file;
              const current = await r.listPapers();
              if (current.some((p) => p.id === id)) return; // already imported
              const title = file.replace(/\.pdf$/i, "");
              addPaper({
                id,
                title,
                authors: "Unknown",
                authorsFull: "",
                year: 0,
                venue: "Watch import",
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
                file,
              });
              showToast(`Imported “${title.slice(0, 36)}” from watch folder`);
            } catch {
              showToast("Couldn't import a watched PDF", "error");
            }
          })();
        }),
      )
      .then((u) => {
        // StrictMode runs effect→cleanup→effect; if we already tore down before
        // listen() resolved, unsubscribe immediately instead of leaking.
        if (!alive) u();
        else unlisten = u;
      });
    return () => {
      alive = false;
      unlisten();
    };
  }, [loaded, watchFolders, libraryLocation, addPaper, r, showToast]);

  const persistCollections = useCallback(
    (next: Collection[]) => {
      setCollections(next);
      track(r.saveCollections(next));
    },
    [r, track],
  );

  const persistFeeds = useCallback(
    (next: Feed[]) => {
      setFeeds(next);
      track(r.saveFeeds(next));
    },
    [r, track],
  );

  // Web capture: the native listener emits `capture-url` (bookmarklet / single
  // link → resolve to a paper) and `capture-clip` (extension clipped a page to
  // Markdown → save as a Markdown item).
  useEffect(() => {
    if (!loaded || !isTauri()) return;
    let alive = true;
    const unlisteners: Array<() => void> = [];
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const u1 = await listen<string>("capture-url", (e) => void captureUrl(e.payload));
      const u2 = await listen<{
        url?: string;
        title?: string;
        author?: string;
        siteName?: string;
        excerpt?: string;
        markdown?: string;
      }>("capture-clip", (e) => void captureClip(e.payload));
      // The extension's "Subscribe" action POSTs a feed/site URL → capture-feed.
      const u3 = await listen<string>("capture-feed", (e) => void subscribeFeed(e.payload));
      if (!alive) {
        u1();
        u2();
        u3();
      } else {
        unlisteners.push(u1, u2, u3);
      }
    });
    return () => {
      alive = false;
      unlisteners.forEach((u) => u());
    };
  }, [loaded, captureUrl, captureClip, subscribeFeed]);

  // Poll subscribed blog feeds on launch and every 15 minutes (native only — the
  // browser preview can't fetch arbitrary cross-origin feeds).
  useEffect(() => {
    if (!loaded || !isTauri()) return;
    void refreshAllFeeds(true);
    const iv = setInterval(() => void refreshAllFeeds(true), 15 * 60 * 1000);
    return () => clearInterval(iv);
  }, [loaded, refreshAllFeeds]);

  // Auto-export library.bib (debounced) whenever the library changes, so an
  // external LaTeX/Overleaf workflow can point at a file that's always current.
  const bibTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!autoBib || !isTauri() || !loaded || !libraryLocation) return;
    clearTimeout(bibTimer.current);
    bibTimer.current = setTimeout(() => {
      const path = `${libraryLocation.replace(/\/+$/, "")}/library.bib`;
      void invoke("write_text_file", { path, contents: exportBibLibrary(papers, "bibtex") }).catch(
        () => {},
      );
    }, 1200);
    return () => clearTimeout(bibTimer.current);
  }, [papers, autoBib, loaded, libraryLocation]);

  const pdfPathFor = useCallback(
    (p: Paper): string | undefined =>
      p.file ? `${libraryLocation.replace(/\/+$/, "")}/${p.file}` : undefined,
    [libraryLocation],
  );

  // Restore a full library from a backup JSON string (used by file import AND
  // WebDAV pull). Validates shape, downloads a safety backup, then replaces.
  // Restore a parsed backup. Confirmation is handled by callers (via requestConfirm)
  // since the in-app dialog is async; this just validates + replaces + safety-backs-up.
  const restoreFromBackupText = useCallback(
    (text: string): boolean => {
      let data: {
        papers?: unknown;
        collections?: unknown;
        feeds?: unknown;
        settings?: Record<string, unknown>;
      };
      try {
        data = JSON.parse(text);
      } catch {
        showToast("Couldn't read backup data", "error");
        return false;
      }
      const incoming = data.papers;
      const valid =
        Array.isArray(incoming) &&
        incoming.every((p) => p && typeof p === "object" && typeof (p as Paper).id === "string");
      if (!valid) {
        showToast("That isn't a valid Marginalia backup", "error");
        return false;
      }
      const newPapers = incoming as Paper[];
      downloadJson("marginalia-backup-before-restore.json", {
        version: 1,
        papers,
        collections,
        feeds,
        settings: { theme, density, view, defaultCite, libraryLocation, watchFolders, glass, model },
      });
      try {
        setPapers(newPapers);
        track(r.replacePapers(newPapers), "Couldn't restore library");
        if (newPapers[0]) setSelectedId(newPapers[0].id);
        if (Array.isArray(data.collections)) persistCollections(data.collections as Collection[]);
        if (Array.isArray(data.feeds)) persistFeeds(data.feeds as Feed[]);
        if (data.settings) {
          const st = data.settings as Record<string, unknown>;
          if (typeof st.theme === "string") setThemeState(st.theme as Theme);
          if (typeof st.density === "string") setDensityState(st.density as Density);
          if (typeof st.view === "string") setViewState(st.view as ViewMode);
          if (typeof st.defaultCite === "string") setDefaultCite(st.defaultCite as CiteStyle);
          if (typeof st.libraryLocation === "string") setLibraryLocation(st.libraryLocation);
          if (Array.isArray(st.watchFolders)) setWatchFolders(st.watchFolders as string[]);
          if (typeof st.glass === "boolean") setGlassState(st.glass);
          if (typeof st.model === "string") {
            setModelState(st.model);
            setAgentModel(st.model);
          }
          track(r.saveSettings(st as Partial<Settings>));
        }
        return true;
      } catch {
        showToast("Restore failed", "error");
        return false;
      }
    },
    [papers, collections, feeds, theme, density, view, defaultCite, libraryLocation, watchFolders, glass, model, persistCollections, persistFeeds, r, track, showToast],
  );

  // ---- WebDAV sync (push/pull), reusable so auto-sync effects can call them ----
  const syncPush = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!isTauri() || !webdavUrl) {
        if (!opts?.silent) showToast("Set a WebDAV URL in Settings first", "info");
        return;
      }
      setSyncing(true);
      try {
        const syncedAt = Date.now();
        const snapshot = JSON.stringify({
          version: 1,
          syncedAt,
          papers,
          collections,
          feeds,
          settings: { theme, density, view, defaultCite, libraryLocation, watchFolders, glass, model },
        });
        const contents = syncPassphrase ? await encryptJson(snapshot, syncPassphrase) : snapshot;
        await invoke("webdav_upload", { url: webdavUrl, user: webdavUser, pass: webdavPass, contents });
        setLastSyncTs(syncedAt);
        persistSettings({ lastSyncTs: syncedAt });
        if (!opts?.silent) showToast(syncPassphrase ? "Library pushed (encrypted) ✓" : "Library pushed to WebDAV ✓");
      } catch (e) {
        if (!opts?.silent) showToast(e instanceof Error ? e.message : "Sync failed", "error");
      } finally {
        setSyncing(false);
      }
    },
    [webdavUrl, webdavUser, webdavPass, syncPassphrase, papers, collections, feeds, theme, density, view, defaultCite, libraryLocation, watchFolders, glass, model, showToast, persistSettings],
  );

  const syncPull = useCallback(
    async (opts?: { silent?: boolean; auto?: boolean }) => {
      if (!isTauri() || !webdavUrl) {
        if (!opts?.silent) showToast("Set a WebDAV URL in Settings first", "info");
        return;
      }
      setSyncing(true);
      try {
        const text = await invoke<string>("webdav_download", { url: webdavUrl, user: webdavUser, pass: webdavPass });
        if (!text.trim()) {
          if (!opts?.silent) showToast("Nothing on the server yet — push first", "info");
          return;
        }
        let plain = text;
        if (isEncrypted(text)) {
          if (!syncPassphrase) {
            if (!opts?.silent) showToast("This library is encrypted — set your sync passphrase first", "error");
            return;
          }
          plain = await decryptJson(text, syncPassphrase);
        }
        let serverTs = 0;
        try {
          serverTs = Number(JSON.parse(plain).syncedAt) || 0;
        } catch {
          /* legacy snapshot without a timestamp */
        }
        // Auto-pull guard (LWW): only restore when the server is newer than our
        // last sync, so a background pull can't clobber with a stale copy.
        if (opts?.auto && serverTs && serverTs <= lastSyncTs) return;
        if (restoreFromBackupText(plain)) {
          if (serverTs) {
            setLastSyncTs(serverTs);
            persistSettings({ lastSyncTs: serverTs });
          }
          if (!opts?.silent) showToast("Library pulled from WebDAV ✓");
        }
      } catch (e) {
        if (!opts?.silent) showToast(e instanceof Error ? e.message : "Sync failed", "error");
      } finally {
        setSyncing(false);
      }
    },
    [webdavUrl, webdavUser, webdavPass, syncPassphrase, lastSyncTs, restoreFromBackupText, showToast, persistSettings],
  );

  // Auto-sync (opt-in, native): pull once on launch (timestamp-guarded)…
  useEffect(() => {
    if (!loaded || !isTauri() || !syncAuto || !webdavUrl) return;
    void syncPull({ silent: true, auto: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);
  // …and push when the app is backgrounded, so edits propagate to other devices.
  useEffect(() => {
    if (!isTauri() || !syncAuto || !webdavUrl) return;
    const onHide = () => {
      if (document.visibilityState === "hidden") void syncPush({ silent: true });
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [syncAuto, webdavUrl, syncPush]);

  const current = papers.find((p) => p.id === selectedId);
  const readerPaper = papers.find((p) => p.id === readerId) || current;

  const filterTitle = (() => {
    if (FILTER_TITLE[filter]) return FILTER_TITLE[filter];
    if (filter.startsWith("tag:")) return "#" + filter.slice(4);
    if (filter.startsWith("feed:")) {
      const fid = filter.slice(5);
      const f = feeds.find((x) => x.id === fid);
      if (f) return f.title;
      const post = papers.find((p) => p.feedId === fid);
      return post ? post.venue : "Feed";
    }
    const c = collections.find((c) => c.id === filter);
    return c ? c.name : "Papers";
  })();
  // Noun for the list header count ("12 bookmarks", "8 posts", …).
  const filterNoun = FILTER_NOUN[filter] ?? (filter.startsWith("feed:") ? "post" : "paper");

  return {
    // state
    loaded,
    narrow,
    mobile: isMobilePlatform(),
    theme,
    density,
    view,
    defaultCite,
    libraryLocation,
    watchFolders,
    glass,
    glassMode: (glass ? GLASS_PLATFORM : "off") as "full" | "acrylic" | "off",
    model,
    embedProvider,
    embedModel,
    voyageKey,
    ttsProvider,
    ttsVoice,
    ttsRate,
    embedStatus,
    indexing,
    autoBib,
    dupOpen,
    capturePort,
    captureUrl,
    claimOpen,
    claimTask,
    claimBusy,
    claimError,
    claimResult,
    filter,
    selectedId,
    sel,
    sortKey,
    sidebar,
    screen,
    annOpen,
    hl,
    palette,
    q,
    importOpen,
    idOpen,
    idText,
    idBusy,
    idError,
    citeOpen,
    citeStyle,
    toast,
    toastKind,
    dialog,
    requestPrompt,
    requestConfirm,
    closeDialog,
    shortcutsOpen,
    openShortcuts: () => setShortcutsOpen(true),
    closeShortcuts: () => setShortcutsOpen(false),
    chatOpen,
    papers,
    collections,

    // derived
    filtered,
    current,
    readerPaper,
    filterTitle,
    filterNoun,
    sortLabel: SORT_LABEL[sortKey],
    showSidebar: sidebar && screen !== "reader",
    counts: {
      all: papers.length,
      recent: papers.filter((p) => Date.now() - p.addedTs <= RECENT_MS).length,
      fav: papers.filter((p) => p.fav).length,
      unread: papers.filter((p) => !p.read && !p.archived).length,
      queue: papers.filter((p) => (p.status ?? (p.read ? "done" : "unread")) !== "done" && !p.archived).length,
      untagged: papers.filter((p) => p.tags.length === 0).length,
      retracted: papers.filter((p) => !!p.retracted).length,
      // web articles (bookmark manager + blog reader)
      articles: papers.filter((p) => isArticle(p) && !p.archived).length,
      bookmarks: papers.filter((p) => isArticle(p) && itemSource(p) !== "feed" && !p.archived).length,
      feedsUnread: papers.filter((p) => isArticle(p) && itemSource(p) === "feed" && !p.read && !p.archived).length,
      archived: papers.filter((p) => p.archived).length,
    },
    // Unread post count per feed id, for the sidebar feed list.
    feedUnread: (() => {
      const m: Record<string, number> = {};
      for (const p of papers)
        if (p.feedId && !p.read && !p.archived) m[p.feedId] = (m[p.feedId] ?? 0) + 1;
      return m;
    })(),

    // settings actions (persisted)
    glassSupported: GLASS_PLATFORM !== "off",
    setGlass: (on: boolean) => {
      setGlassState(on);
      persistSettings({ glass: on });
    },
    setModel: (m: string) => {
      setModelState(m);
      setAgentModel(m);
      persistSettings({ model: m });
    },

    // ---- semantic search (Voyage embeddings) ----
    setVoyageKey: (k: string) => {
      setVoyageKeyState(k);
      persistSettings({ voyageKey: k, embedProvider: k ? "voyage" : "off" });
      setEmbedProviderState(k ? "voyage" : "off");
      void embeddingStatus().then(setEmbedStatus);
    },
    setTtsProvider: (p: string) => {
      setTtsProviderState(p);
      persistSettings({ ttsProvider: p });
    },
    setTtsVoice: (v: string) => {
      setTtsVoiceState(v);
      persistSettings({ ttsVoice: v });
    },
    setTtsRate: (rate: number) => {
      setTtsRateState(rate);
      persistSettings({ ttsRate: rate });
    },
    setEmbedModel: (m: string) => {
      setEmbedModelState(m);
      persistSettings({ embedModel: m });
      void embeddingStatus().then(setEmbedStatus);
    },
    // Embed every paper (skips unchanged ones), in batches, with progress.
    buildIndex: async () => {
      if (!isTauri() || indexing) return;
      const items = papers.map((p) => ({ id: p.id, text: buildEmbedText(p) }));
      if (!items.length) {
        showToast("No papers to index");
        return;
      }
      setIndexing(true);
      let embedded = 0;
      let skipped = 0;
      try {
        for (let i = 0; i < items.length; i += 50) {
          const res = await embedPapers(items.slice(i, i + 50));
          embedded += res.embedded;
          skipped += res.skipped;
          showToast(`Indexing… ${Math.min(i + 50, items.length)}/${items.length}`);
        }
        setEmbedStatus(await embeddingStatus());
        showToast(`Indexed ${embedded} paper${embedded === 1 ? "" : "s"}${skipped ? ` (${skipped} unchanged)` : ""} ✨`);
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Indexing failed", "error");
      } finally {
        setIndexing(false);
      }
    },
    // Hybrid retrieval: fuse lexical + semantic (RRF). Falls back to lexical when
    // there's no index/key. Used by "Ask your library".
    hybridRetrieve: async (query: string, k = 16): Promise<Paper[]> => {
      const byId = (id: string) => papers.find((p) => p.id === id);
      const lex = retrieveForChat(papers, query, k).map((p) => p.id);
      const sem = (await semanticSearch(query, k)).map((h) => h.id);
      if (!sem.length) {
        const ids = lex.length ? lex : filtered.slice(0, k).map((p) => p.id);
        return ids.map(byId).filter((p): p is Paper => !!p);
      }
      const score = new Map<string, number>();
      for (const list of [lex, sem])
        list.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (60 + i)));
      // resolve ids → papers and drop stale embedded ids BEFORE slicing, so
      // missing papers don't consume top-k slots and under-fill the context
      return [...score.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => byId(id))
        .filter((p): p is Paper => !!p)
        .slice(0, k);
    },
    getSimilar: async (id: string, k = 5): Promise<Paper[]> => {
      const hits = await similarPapersCmd(id, k);
      return hits.map((h) => papers.find((p) => p.id === h.id)).filter((p): p is Paper => !!p);
    },
    setTheme: (t: Theme) => {
      setThemeState(t);
      persistSettings({ theme: t });
    },
    toggleTheme: () => {
      const t = theme === "dark" ? "light" : "dark";
      setThemeState(t);
      persistSettings({ theme: t });
    },
    setDensity: (d: Density) => {
      setDensityState(d);
      persistSettings({ density: d });
    },
    setView: (v: ViewMode) => {
      setViewState(v);
      persistSettings({ view: v });
    },
    setDefaultCite: (c: CiteStyle) => {
      setDefaultCite(c);
      setCiteStyle(c);
      persistSettings({ defaultCite: c });
    },
    addWatchFolder: (rawPath: string) => {
      const path = rawPath.trim().replace(/\/+$/, "");
      if (!path) return;
      if (watchFolders.includes(path)) {
        showToast("Already watching that folder", "info");
        return;
      }
      const next = [...watchFolders, path];
      setWatchFolders(next);
      persistSettings({ watchFolders: next });
      // only claim success once the native watcher actually started
      if (isTauri()) {
        void invoke("start_watch", { folders: next })
          .then(() => showToast("Watch folder added"))
          .catch(() => showToast("Couldn't watch that folder", "error"));
      } else {
        showToast("Watch folder added");
      }
    },
    removeWatchFolder: (path: string) => {
      const next = watchFolders.filter((w) => w !== path);
      setWatchFolders(next);
      persistSettings({ watchFolders: next });
      if (isTauri()) void invoke("start_watch", { folders: next }).catch(() => {});
    },
    setLibraryLocation: (path: string) => {
      setLibraryLocation(path);
      persistSettings({ libraryLocation: path });
    },
    libraryLocationSet: librarySet,
    // onboarding: pick a folder where all PDFs (and the library) are stored
    chooseLibrary: async () => {
      const folder = await chooseLibraryFolder();
      if (!folder) return;
      setLibraryLocation(folder);
      setLibrarySet(true);
      persistSettings({ libraryLocation: folder, librarySet: true });
      setScreen("library");
      const n = await scanInto(folder);
      showToast(
        n ? `Found ${n} PDF${n > 1 ? "s" : ""} in your folder` : "Library folder set",
      );
    },
    // re-scan the current library folder for PDFs (Settings button)
    rescanLibrary: async () => {
      const n = await scanInto(libraryLocation);
      showToast(
        n ? `Added ${n} new PDF${n > 1 ? "s" : ""}` : "No new PDFs found",
      );
    },
    // native: pick PDFs, copy them into the library folder, add as papers
    importFiles: async () => {
      if (!isTauri()) {
        setImportOpen(true);
        return;
      }
      const paths = await pickPdfFiles();
      let n = 0;
      for (const src of paths) {
        try {
          const file = await importPdf(src, libraryLocation);
          const title = file.replace(/\.pdf$/i, "");
          addPaper({
            id: "file:" + file,
            title,
            authors: "Unknown",
            authorsFull: "",
            year: 0,
            venue: "Imported PDF",
            doi: "—",
            arxiv: "—",
            tags: [],
            read: false,
            fav: false,
            added: "just now",
            addedTs: Date.now() + n,
            abstract: "",
            notes: "",
            hl: [],
            file,
          });
          n++;
        } catch {
          /* skip files that fail to copy */
        }
      }
      if (n) showToast(`Imported ${n} PDF${n > 1 ? "s" : ""}`);
    },

    // navigation / selection
    setSortKey,
    cycleSort: () =>
      setSortKey((k) =>
        k === "added" ? "year" : k === "year" ? "title" : "added",
      ),
    toggleSidebar: () => setSidebar((s) => !s),
    pickFilter: (f: Filter) => {
      setSel([]); // a stale multi-selection from another filter shouldn't carry over
      setFilter(f);
      setScreen("library");
      setDrawerOpen(false);
    },
    goScreen: (sc: Screen) => {
      setSel([]);
      setScreen(sc);
      setDrawerOpen(false);
    },
    drawerOpen,
    toggleDrawer: () => setDrawerOpen((o) => !o),
    closeDrawer: () => setDrawerOpen(false),
    // a plain (non-modifier) selection clears any lingering multi-selection
    select: (id: string) => {
      setSel([]);
      setSelectedId(id);
    },
    setSel,
    toggleSel: (id: string) =>
      setSel((cur) =>
        cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
      ),
    clearSel: () => setSel([]),
    bulkRead: () => {
      const ids = sel;
      const done = (p: Paper): Partial<Paper> =>
        isBookmark(p) ? { read: true, status: "done", archived: true } : { read: true, status: "done" };
      setPapers((ps) => ps.map((p) => (ids.includes(p.id) ? { ...p, ...done(p) } : p)));
      ids.forEach((id) => {
        const p = papers.find((x) => x.id === id);
        if (p) track(r.updatePaper(id, done(p)));
      });
      setSel([]);
      showToast(`${ids.length} marked read`);
    },
    toggleStar,
    toggleRead,
    patchPaper,
    addPaper,
    aiBusyId,
    pdfPathFor,

    // ---- editing ----
    setNotes: (id: string, notes: string) => patchPaper(id, { notes }),
    setField: (id: string, patch: Partial<Paper>) => patchPaper(id, patch),
    addTag: (id: string, tag: string) => {
      const t = tag.trim();
      const p = papers.find((x) => x.id === id);
      if (!t || !p || p.tags.includes(t)) return;
      patchPaper(id, { tags: [...p.tags, t] });
    },
    removeTag: (id: string, tag: string) => {
      const p = papers.find((x) => x.id === id);
      if (p) patchPaper(id, { tags: p.tags.filter((t) => t !== tag) });
    },
    setStatus: (id: string, status: Paper["status"]) => {
      const p = papers.find((x) => x.id === id);
      const patch: Partial<Paper> = { status, read: status === "done" };
      // Bookmarks: "Done" archives, "To read"/"Reading" returns it to the inbox.
      if (p && isBookmark(p)) patch.archived = status === "done";
      // When a selected bookmark is finished, advance to the next item in view so
      // the detail panel shows what's next rather than the just-archived one.
      const advance =
        p && isBookmark(p) && status === "done" && selectedId === id ? neighborInView(id) : undefined;
      patchPaper(id, patch);
      if (advance) setSelectedId(advance);
    },
    // Reader "✓ Done": finish the current item and open the next unread in the
    // reader (continuous reading), or fall back to the library when none remain.
    markDoneAndNext: (id: string) => {
      const next = neighborInView(id);
      const p = papers.find((x) => x.id === id);
      const patch: Partial<Paper> = { status: "done", read: true };
      if (p && isBookmark(p)) patch.archived = true;
      patchPaper(id, patch);
      if (next) {
        setReaderId(next);
        setSelectedId(next);
      } else {
        setScreen("library");
      }
    },
    deletePaper: (id: string) => {
      // strip dangling related back-references in other papers
      setPapers((ps) =>
        ps
          .filter((p) => p.id !== id)
          .map((p) =>
            p.related?.includes(id) ? { ...p, related: p.related.filter((x) => x !== id) } : p,
          ),
      );
      track(r.deletePaper(id));
      papers.forEach((p) => {
        if (p.id !== id && p.related?.includes(id)) {
          track(r.updatePaper(p.id, { related: p.related.filter((x) => x !== id) }));
        }
      });
      // drop from any collection
      const next = collections.map((c) => ({ ...c, ids: c.ids.filter((x) => x !== id) }));
      if (next.some((c, i) => c.ids.length !== collections[i].ids.length)) persistCollections(next);
      setSel((cur) => cur.filter((x) => x !== id));
      // reselect the neighbour in the current view, not an arbitrary paper
      const view = filtered.filter((p) => p.id !== id);
      const idx = filtered.findIndex((p) => p.id === id);
      const neighbour = view[Math.min(idx, view.length - 1)] ?? view[0];
      if (selectedId === id && neighbour) setSelectedId(neighbour.id);
      // if the deleted paper was open in the reader, follow to its neighbour too
      if (readerId === id) setReaderId(neighbour ? neighbour.id : "");
      showToast("Paper deleted", "info");
    },

    // ---- related links ----
    addRelated: (id: string, otherId: string) => {
      const p = papers.find((x) => x.id === id);
      if (!p || id === otherId) return;
      const cur = p.related ?? [];
      if (cur.includes(otherId)) return;
      patchPaper(id, { related: [...cur, otherId] });
      // make it bidirectional
      const o = papers.find((x) => x.id === otherId);
      if (o && !(o.related ?? []).includes(id)) {
        patchPaper(otherId, { related: [...(o.related ?? []), id] });
      }
    },
    removeRelated: (id: string, otherId: string) => {
      const p = papers.find((x) => x.id === id);
      if (p) patchPaper(id, { related: (p.related ?? []).filter((x) => x !== otherId) });
      const o = papers.find((x) => x.id === otherId);
      if (o) patchPaper(otherId, { related: (o.related ?? []).filter((x) => x !== id) });
    },

    // ---- markdown / Obsidian export ----
    exportPaperMarkdown: async (id: string) => {
      const p = papers.find((x) => x.id === id);
      if (!p) return;
      const where = await exportPaperMd(p, papers, libraryLocation);
      showToast(`Exported → ${where}`);
    },
    exportLibraryMarkdown: async () => {
      const n = await exportLibraryMd(papers, libraryLocation);
      showToast(`Exported ${n} notes`);
    },

    // ---- retraction checks (Crossref / Retraction Watch) ----
    // Check every DOI-bearing paper and flag retractions. Privacy-preserving:
    // one DOI per query, nothing else about the library leaves the machine.
    checkRetractions: async () => {
      const targets = papers.filter((p) => p.doi && p.doi !== "—");
      if (!targets.length) {
        showToast("No papers with a DOI to check");
        return;
      }
      let checked = 0;
      let found = 0;
      for (const p of targets) {
        const r = await checkRetraction(p.doi);
        checked++;
        if (r) found++;
        patchPaper(p.id, { retracted: r ?? null, retractionChecked: Date.now() });
        if (checked % 5 === 0 && checked < targets.length)
          showToast(`Checking retractions… ${checked}/${targets.length}`);
      }
      showToast(
        found ? `⚠ ${found} retracted paper${found === 1 ? "" : "s"} flagged` : "No retractions found ✓",
        found ? "error" : "success",
      );
    },

    // ---- BibTeX auto-export (LaTeX / Overleaf) ----
    setAutoBib: (on: boolean) => {
      setAutoBibState(on);
      persistSettings({ autoBib: on });
      if (on) showToast("library.bib will stay in sync");
    },
    exportBibNow: async () => {
      const bib = exportBibLibrary(papers, "bibtex");
      if (isTauri() && libraryLocation) {
        const path = `${libraryLocation.replace(/\/+$/, "")}/library.bib`;
        try {
          await invoke("write_text_file", { path, contents: bib });
          showToast("Wrote library.bib");
        } catch {
          showToast("Couldn't write library.bib", "error");
        }
      } else {
        const url = URL.createObjectURL(new Blob([bib], { type: "text/plain" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = "library.bib";
        a.click();
        URL.revokeObjectURL(url);
      }
    },

    // ---- duplicate detection / merge ----
    openDuplicates: () => setDupOpen(true),
    closeDuplicates: () => setDupOpen(false),
    duplicateGroups: (): DuplicateGroup[] => findDuplicates(papers),
    // Merge one detected group into its most-complete record; delete the rest and
    // repoint collection memberships at the survivor.
    mergeDuplicate: (group: Paper[]) => {
      if (group.length < 2) return;
      const { merged, dropIds } = mergePapers(group);
      const dropSet = new Set(dropIds);
      setPapers((ps) =>
        ps
          .filter((p) => !dropSet.has(p.id))
          .map((p) =>
            p.id === merged.id
              ? merged
              : p.related?.some((x) => dropSet.has(x))
                ? { ...p, related: [...new Set(p.related.map((x) => (dropSet.has(x) ? merged.id : x)))].filter((x) => x !== p.id) }
                : p,
          ),
      );
      track(r.updatePaper(merged.id, merged));
      dropIds.forEach((id) => track(r.deletePaper(id)));
      // collections: replace any dropped id with the survivor (dedup per collection)
      const nextCols = collections.map((c) =>
        c.ids.some((x) => dropSet.has(x))
          ? { ...c, ids: [...new Set(c.ids.map((x) => (dropSet.has(x) ? merged.id : x)))] }
          : c,
      );
      if (nextCols.some((c, i) => c.ids.length !== collections[i].ids.length || c.ids.some((x, j) => x !== collections[i].ids[j])))
        persistCollections(nextCols);
      if (dropSet.has(selectedId)) setSelectedId(merged.id);
      if (dropSet.has(readerId)) setReaderId(merged.id);
      showToast(`Merged ${group.length} papers into one`);
    },

    // ---- full backup (JSON) ----
    exportBackup: () => {
      downloadJson("marginalia-backup.json", {
        version: 1,
        papers,
        collections,
        feeds,
        settings: { theme, density, view, defaultCite, libraryLocation, watchFolders, glass, model },
      });
      showToast("Backup downloaded");
    },
    importBackup: (text: string) => {
      void requestConfirm({
        title: "Restore this backup?",
        body: "This replaces your current library. A safety backup of your current library downloads first.",
        confirmLabel: "Restore",
        danger: true,
      }).then((ok) => {
        if (ok && restoreFromBackupText(text)) showToast("Library restored");
      });
    },
    // Import a Pocket export (ril_export.html) as bookmarks (Pocket shut down 2025).
    importPocket: async (html: string) => {
      const items = parsePocketHtml(html);
      if (!items.length) {
        showToast("No bookmarks found in that file", "error");
        return;
      }
      const current = await r.listPapers();
      const have = new Set(current.map((p) => p.id));
      const t0 = Date.now();
      const fresh: Paper[] = [];
      items.forEach((it, i) => {
        const clean = it.url.split(/[?#]/)[0];
        const id = "web:" + clean;
        if (have.has(id)) return;
        have.add(id);
        let host = "Web";
        try {
          host = new URL(it.url).hostname.replace(/^www\./, "");
        } catch {
          /* keep */
        }
        fresh.push({
          id,
          kind: "article",
          source: "clip",
          title: it.title || host,
          authors: host,
          authorsFull: "",
          year: 0,
          venue: host,
          doi: "—",
          arxiv: "—",
          tags: it.tags,
          read: false,
          fav: false,
          added: "imported",
          addedTs: it.addedTs || t0 + i,
          abstract: "",
          notes: it.url,
          url: clean,
          favicon: faviconUrl(host),
          hl: [],
          markdown: `[Open original ↗](${it.url})`,
        });
      });
      for (const p of fresh) await r.addPaper(p);
      if (fresh.length) {
        setPapers((prev) => {
          const ids = new Set(prev.map((p) => p.id));
          return [...fresh.filter((p) => !ids.has(p.id)), ...prev];
        });
        setFilter("bookmarks");
        setScreen("library");
      }
      showToast(`Imported ${fresh.length} bookmark${fresh.length === 1 ? "" : "s"} from Pocket ✨`);
    },

    // ---- optional WebDAV sync (user-hosted), with optional E2E encryption ----
    webdavUrl,
    webdavUser,
    webdavPass,
    syncPassphrase,
    syncing,
    setWebdav: (url: string, user: string, pass: string) => {
      setWebdavUrlState(url);
      setWebdavUserState(user);
      setWebdavPassState(pass);
      persistSettings({ webdavUrl: url, webdavUser: user, webdavPass: pass });
    },
    setSyncPassphrase: (p: string) => {
      setSyncPassphraseState(p);
      persistSettings({ syncPassphrase: p });
    },
    syncAuto,
    setSyncAuto: (on: boolean) => {
      setSyncAutoState(on);
      persistSettings({ syncAuto: on });
      if (on && isTauri() && webdavUrl) void syncPull({ silent: true, auto: true });
    },
    // ---- self-hosted AI backend (enables AI on iOS/web) ----
    apiUrl,
    apiToken,
    setAiBackend: (url: string, token: string) => {
      const u = url.trim();
      const tk = token.trim();
      setApiUrlState(u);
      setApiTokenState(tk);
      setAgentBackend(u, tk);
      persistSettings({ apiUrl: u, apiToken: tk });
    },
    syncToWebdav: () => syncPush(),
    syncFromWebdav: () => syncPull(),

    // ---- flashcards (SM-2-lite) ----
    reviewCard: (paperId: string, idx: number, grade: "again" | "good" | "easy") => {
      const p = papers.find((x) => x.id === paperId);
      if (!p) return;
      const cards = { ...(p.cards ?? {}) };
      const prev = cards[idx] ?? { due: 0, ease: 2.3, reps: 0 };
      const DAY = 86400000;
      let ease = prev.ease;
      let reps = prev.reps;
      let intervalDays: number;
      if (grade === "again") {
        reps = 0;
        ease = Math.max(1.3, ease - 0.2);
        intervalDays = 0; // ~10 min → treat as due today (0)
      } else {
        reps += 1;
        if (grade === "easy") ease += 0.15;
        intervalDays = reps === 1 ? 1 : reps === 2 ? 3 : Math.round((reps - 1) * ease);
        if (grade === "easy") intervalDays = Math.round(intervalDays * 1.3);
      }
      cards[idx] = { due: Date.now() + intervalDays * DAY, ease, reps };
      patchPaper(paperId, { cards });
    },

    // ---- highlights ----
    updateHighlight: (paperId: string, index: number, patch: Partial<Paper["hl"][number]>) => {
      const p = papers.find((x) => x.id === paperId);
      if (!p) return;
      const hl = p.hl.map((h, i) => (i === index ? { ...h, ...patch } : h));
      patchPaper(paperId, { hl });
    },
    deleteHighlight: (paperId: string, index: number) => {
      const p = papers.find((x) => x.id === paperId);
      if (!p) return;
      const patch: Partial<Paper> = { hl: p.hl.filter((_, i) => i !== index) };
      // keep flashcard SRS state attached to the right highlight after the shift
      if (p.cards) patch.cards = reindexCards(p.cards, index);
      patchPaper(paperId, patch);
    },

    // ---- collections ----
    createCollection: (name: string) => {
      const n = name.trim();
      if (!n) return;
      const colors = ["#4B57D6", "#2E9E6B", "#E0A23A", "#C0395E", "#7C84FF"];
      const id = "col-" + n.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString(36);
      persistCollections([
        ...collections,
        { id, name: n, color: colors[collections.length % colors.length], indent: "0", ids: [] },
      ]);
      showToast(`Collection “${n}” created`);
    },
    renameCollection: (id: string, name: string) => {
      const n = name.trim();
      if (!n) return;
      persistCollections(collections.map((c) => (c.id === id ? { ...c, name: n } : c)));
    },
    deleteCollection: (id: string) => {
      persistCollections(collections.filter((c) => c.id !== id));
      if (filter === id) setFilter("all");
      showToast("Collection deleted");
    },
    togglePaperInCollection: (colId: string, paperId: string) => {
      persistCollections(
        collections.map((c) =>
          c.id === colId
            ? {
                ...c,
                ids: c.ids.includes(paperId)
                  ? c.ids.filter((x) => x !== paperId)
                  : [...c.ids, paperId],
              }
            : c,
        ),
      );
    },

    // ---- feeds (blog reader) ----
    feeds,
    subscribeFeed,
    refreshFeed,
    refreshAllFeeds,
    exportFeedsOPML: () => {
      if (!feeds.length) {
        showToast("No feeds to export");
        return;
      }
      downloadText("marginalia-feeds.opml", feedsToOPML(feeds), "text/xml");
      showToast("Exported feeds.opml");
    },
    importFeedsOPML: async (text: string) => {
      const urls = opmlToUrls(text);
      if (!urls.length) {
        showToast("No feeds found in that OPML", "error");
        return;
      }
      showToast(`Importing ${urls.length} feed${urls.length === 1 ? "" : "s"}…`, "info");
      let ok = 0;
      for (const u of urls) if ((await subscribeFeed(u, { silent: true })) !== null) ok++;
      setScreen("feeds");
      showToast(`Imported ${ok}/${urls.length} feed${urls.length === 1 ? "" : "s"} ✨`);
    },
    markFeedRead: (id: string) => {
      const targets = papers.filter((p) => p.feedId === id && !p.read);
      if (!targets.length) return;
      setPapers((ps) =>
        ps.map((p) => (p.feedId === id && !p.read ? { ...p, read: true, status: "done" } : p)),
      );
      targets.forEach((p) => track(r.updatePaper(p.id, { read: true, status: "done" })));
      showToast(`Marked ${targets.length} post${targets.length === 1 ? "" : "s"} read`);
    },
    markAllFeedsRead: () => {
      const targets = papers.filter((p) => itemSource(p) === "feed" && isArticle(p) && !p.read);
      if (!targets.length) {
        showToast("No unread posts");
        return;
      }
      const ids = new Set(targets.map((p) => p.id));
      setPapers((ps) => ps.map((p) => (ids.has(p.id) ? { ...p, read: true, status: "done" } : p)));
      targets.forEach((p) => track(r.updatePaper(p.id, { read: true, status: "done" })));
      showToast(`Marked ${targets.length} post${targets.length === 1 ? "" : "s"} read`);
    },
    archiveItem: (id: string) => {
      patchPaper(id, { archived: true, read: true, status: "done" });
      showToast("Archived", "info");
    },
    unarchiveItem: (id: string) => {
      patchPaper(id, { archived: false });
      showToast("Restored from archive", "info");
    },
    removeFeed: (id: string, alsoPosts = false) => {
      persistFeeds(feeds.filter((f) => f.id !== id));
      if (alsoPosts) {
        const drop = new Set(papers.filter((p) => p.feedId === id).map((p) => p.id));
        if (drop.size) {
          setPapers((ps) => ps.filter((p) => !drop.has(p.id)));
          drop.forEach((pid) => track(r.deletePaper(pid)));
        }
      }
      if (filter === "feed:" + id) setFilter("feeds");
      showToast("Unsubscribed");
    },
    renameFeed: (id: string, title: string) => {
      const t = title.trim();
      if (!t) return;
      persistFeeds(feeds.map((f) => (f.id === id ? { ...f, title: t } : f)));
    },
    setFeedFolder: (id: string, folder: string) => {
      const f = folder.trim();
      persistFeeds(feeds.map((x) => (x.id === id ? { ...x, folder: f || undefined } : x)));
    },

    // ---- bulk ----
    bulkAddTag: (tag: string) => {
      const t = tag.trim();
      if (!t) return;
      const ids = sel;
      setPapers((ps) =>
        ps.map((p) =>
          ids.includes(p.id) && !p.tags.includes(t) ? { ...p, tags: [...p.tags, t] } : p,
        ),
      );
      ids.forEach((id) => {
        const p = papers.find((x) => x.id === id);
        if (p && !p.tags.includes(t)) void r.updatePaper(id, { tags: [...p.tags, t] });
      });
      setSel([]);
      showToast(`Tagged ${ids.length} papers “${t}”`);
    },
    bulkDelete: () => {
      const ids = sel;
      const idSet = new Set(ids);
      setPapers((ps) =>
        ps
          .filter((p) => !idSet.has(p.id))
          .map((p) =>
            p.related?.some((x) => idSet.has(x))
              ? { ...p, related: p.related.filter((x) => !idSet.has(x)) }
              : p,
          ),
      );
      ids.forEach((id) => track(r.deletePaper(id)));
      papers.forEach((p) => {
        if (!idSet.has(p.id) && p.related?.some((x) => idSet.has(x))) {
          track(r.updatePaper(p.id, { related: p.related.filter((x) => !idSet.has(x)) }));
        }
      });
      persistCollections(
        collections.map((c) => ({ ...c, ids: c.ids.filter((x) => !idSet.has(x)) })),
      );
      // if the open reader paper was among them, drop it
      if (idSet.has(readerId)) setReaderId(papers.find((p) => !idSet.has(p.id))?.id ?? "");
      setSel([]);
      showToast(`Deleted ${ids.length} papers`, "info");
    },
    bulkAddToCollection: (colId: string) => {
      const ids = sel;
      persistCollections(
        collections.map((c) =>
          c.id === colId
            ? { ...c, ids: [...new Set([...c.ids, ...ids])] }
            : c,
        ),
      );
      setSel([]);
      showToast(`Added ${ids.length} papers to collection`);
    },

    // ---- AI: extract metadata / summarize ----
    extractMetadata: async (id: string) => {
      const p = papers.find((x) => x.id === id);
      if (!p) return;
      setAiBusyId(id);
      try {
        // Fetch the PDF if it isn't cached yet (papers added by ID/Discovery).
        const pdf = await ensureLocalPdfPath(p, libraryLocation, (file) =>
          patchPaper(p.id, { file }),
        );
        if (!pdf) {
          showToast("No PDF available to read for this paper.");
          return;
        }
        const m = await extractMetadata(pdf, p);
        const patch: Partial<Paper> = {};
        if (typeof m.title === "string" && m.title) patch.title = m.title;
        if (typeof m.authorsShort === "string" && m.authorsShort !== "—") patch.authors = m.authorsShort;
        if (typeof m.authorsFull === "string" && m.authorsFull !== "—") patch.authorsFull = m.authorsFull;
        if (typeof m.year === "number" && m.year) patch.year = m.year;
        if (typeof m.venue === "string" && m.venue !== "—") patch.venue = m.venue;
        if (typeof m.doi === "string" && m.doi) patch.doi = m.doi;
        if (typeof m.arxiv === "string" && m.arxiv) patch.arxiv = m.arxiv;
        if (typeof m.abstract === "string" && m.abstract) patch.abstract = m.abstract;
        if (Array.isArray(m.tags) && m.tags.length) {
          patch.tags = [...new Set([...(p.tags || []), ...m.tags.map(String)])];
        }
        patchPaper(id, patch);
        showToast("Metadata extracted ✨");
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Extraction failed", "error");
      } finally {
        setAiBusyId(null);
      }
    },
    bulkBusy,
    // AI-categorize one paper (prefers existing tag vocabulary; reads the PDF
    // only when there's no abstract to work from).
    autoTag: async (id: string) => {
      const p = papers.find((x) => x.id === id);
      if (!p) return;
      const vocab = [...new Set(papers.flatMap((x) => x.tags))];
      const needAuthors = !p.authorsFull || !p.authors || p.authors === "Unknown";
      const pdf = !p.abstract || needAuthors ? pdfPathFor(p) : undefined;
      setAiBusyId(id);
      try {
        const m = await agentAutoTag(p, vocab, pdf);
        const add = [...(m.tags ?? []), ...(m.category ? [m.category] : [])];
        const patch: Partial<Paper> = { tags: [...new Set([...(p.tags || []), ...add])] };
        if (Array.isArray(m.concepts) && m.concepts.length)
          patch.concepts = [...new Set(m.concepts.map(String))];
        enrich(patch, p, m);
        patchPaper(id, patch);
        // Auto-file into a collection named after the AI category.
        if (m.category) persistCollections(fileInCategory(collections, m.category, id));
        showToast(m.category ? `Filed in “${m.category}” ✨` : "Categorised ✨");
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Tagging failed", "error");
      } finally {
        setAiBusyId(null);
      }
    },
    // AI-categorize every untagged paper, growing a shared vocabulary as it goes
    // so the taxonomy stays consistent.
    autoTagUntagged: async () => {
      const targets = papers.filter((p) => p.tags.length === 0);
      if (!targets.length) {
        showToast("Every paper already has tags");
        return;
      }
      setBulkBusy(true);
      let done = 0;
      let vocab = [...new Set(papers.flatMap((x) => x.tags))];
      let cols = collections;
      const filed = new Set<string>();
      for (const p of targets) {
        try {
          const needAuthors = !p.authorsFull || !p.authors || p.authors === "Unknown";
          const pdf = !p.abstract || needAuthors ? pdfPathFor(p) : undefined;
          const m = await agentAutoTag(p, vocab, pdf);
          const add = [...(m.tags ?? []), ...(m.category ? [m.category] : [])];
          const patch: Partial<Paper> = { tags: [...new Set(add)] };
          if (Array.isArray(m.concepts) && m.concepts.length)
            patch.concepts = [...new Set(m.concepts.map(String))];
          enrich(patch, p, m);
          patchPaper(p.id, patch);
          // Auto-file into a collection named after the AI category (one persist
          // at the end so the batch doesn't thrash the store).
          if (m.category) {
            cols = fileInCategory(cols, m.category, p.id, done);
            filed.add(m.category);
          }
          vocab = [...new Set([...vocab, ...add])];
          done++;
          if (done % 3 === 0) showToast(`Categorised ${done}/${targets.length}…`);
        } catch {
          /* skip a failure, keep going */
        }
      }
      if (cols !== collections) persistCollections(cols);
      setBulkBusy(false);
      showToast(
        filed.size > 0
          ? `Auto-tagged ${done} paper${done === 1 ? "" : "s"} into ${filed.size} collection${filed.size === 1 ? "" : "s"} ✨`
          : `Auto-tagged ${done} paper${done === 1 ? "" : "s"} ✨`,
      );
    },
    summarize: async (id: string) => {
      const p = papers.find((x) => x.id === id);
      if (!p) return;
      setAiBusyId(id);
      let acc = "";
      // Use the PDF when we can fetch it (richer summary); otherwise the sidecar
      // summarises from the abstract/metadata, so abstract-only papers work too.
      const pdf = await ensureLocalPdfPath(p, libraryLocation, (file) => patchPaper(p.id, { file }));
      await summarizePaper(p, pdf, {
        onDelta: (t) => {
          acc += t;
        },
        onDone: () => {
          if (acc.trim()) {
            patchPaper(id, { summary: acc.trim() });
            showToast("Summary generated ✨");
          }
          setAiBusyId(null);
        },
        onError: (msg) => {
          showToast(msg, "error");
          setAiBusyId(null);
        },
      });
    },

    // reader
    setAnnOpen,
    toggleAnn: () => setAnnOpen((a) => !a),
    setHl: (c: string) => {
      setHl(c);
      showToast("Highlight color set");
    },
    addHighlight: (paperId: string, text: string, page: number, color?: string) => {
      const p = papers.find((x) => x.id === paperId);
      if (!p) return;
      const next = [...p.hl, { text, color: color ?? hl, page, note: "" }];
      patchPaper(paperId, { hl: next });
      showToast("Highlight saved");
    },
    addNote: (paperId: string, page: number, note: string) => {
      const p = papers.find((x) => x.id === paperId);
      if (!p || !note.trim()) return;
      patchPaper(paperId, {
        hl: [...p.hl, { text: "📝 " + note.trim(), color: hl, page, note: "" }],
      });
      showToast("Note added");
    },
    openReader: (id: string) => {
      setReaderId(id);
      setScreen("reader");
    },

    // search palette
    openPalette: () => {
      setQ("");
      setPalette(true);
    },
    closePalette: () => setPalette(false),
    setQ,
    searchResults: (query: string) => searchPapers(papers, query),
    paletteOpen: (id: string) => {
      setSelectedId(id);
      setPalette(false);
      setScreen("library");
    },

    // import / identifier
    openImport: () => setImportOpen(true),
    importBibliography: (text: string) => {
      const parsed = parseBibliography(text);
      parsed.forEach((p) => addPaper(p));
      setImportOpen(false);
      showToast(
        parsed.length
          ? `Imported ${parsed.length} paper${parsed.length > 1 ? "s" : ""}`
          : "No entries found",
      );
    },
    openIdentifier: () => {
      setIdText("");
      setIdError("");
      setIdOpen(true);
    },
    setIdText,
    lookupIdentifier: async () => {
      const text = idText.trim();
      if (!text) return;
      setIdBusy(true);
      setIdError("");
      try {
        const paper = await lookupIdentifier(text);
        if (papers.some((p) => p.id === paper.id)) {
          setIdError("Already in your library.");
          setIdBusy(false);
          return;
        }
        addPaper(paper);
        setIdBusy(false);
        setIdOpen(false);
        setSelectedId(paper.id);
        showToast(`Added “${paper.title.slice(0, 40)}…”`);
        // Flag the new paper if it's been retracted (fire-and-forget).
        if (paper.doi && paper.doi !== "—") {
          void checkRetraction(paper.doi).then((r) => {
            patchPaper(paper.id, { retracted: r ?? null, retractionChecked: Date.now() });
            if (r) showToast(`⚠ This paper has a ${r.reason.toLowerCase()} notice`, "error");
          });
        }
      } catch (e) {
        setIdBusy(false);
        setIdError(e instanceof Error ? e.message : "Lookup failed.");
      }
    },

    // citation
    openCite: () => {
      setCiteStyle(defaultCite);
      setCiteOpen(true);
    },
    setCiteStyle,
    copyCite: async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        showToast("Citation copied to clipboard");
      } catch {
        showToast("Copy failed — select and copy manually", "error");
      }
      setCiteOpen(false);
    },

    // ---- recommendations (Semantic Scholar) ----
    recs,
    recsLoading,
    recsError,
    loadRecommendations: async () => {
      if (recsLoading) return;
      const seeds = [...papers]
        .filter((p) => (p.arxiv && p.arxiv !== "—") || (p.doi && p.doi !== "—"))
        .sort((a, b) => Number(b.fav) - Number(a.fav) || b.addedTs - a.addedTs)
        .slice(0, 12);
      if (!seeds.length) {
        setRecs([]);
        setRecsError("Add a paper with an arXiv ID or DOI to get recommendations.");
        return;
      }
      setRecsLoading(true);
      setRecsError("");
      try {
        const hits = await recommendFromLibrary(seeds, 16);
        const have = new Set(
          papers.flatMap((p) => [p.id, p.doi, p.arxiv].filter((x) => x && x !== "—")),
        );
        const fresh = hits
          .filter((h) => !have.has(h.doi) && !have.has(h.arxiv) && !have.has(h.id))
          // drop repository-stub / junk titles S2 occasionally returns ("UvA-DARE (")
          .filter((h) => h.title && h.title.replace(/[^A-Za-z0-9]/g, "").length >= 8)
          .slice(0, 8);
        setRecs(fresh);
        setRecsError(fresh.length ? "" : "No new recommendations right now — try refreshing.");
      } catch {
        setRecsError("Couldn't reach Semantic Scholar (rate-limited?). Try again.");
      } finally {
        setRecsLoading(false);
      }
    },
    addDiscovered: (hit: DiscoverHit) => {
      const p = hitToPaper(hit);
      if (papers.some((x) => x.id === p.id)) {
        showToast("Already in your library", "info");
        return;
      }
      addPaper(p);
      setRecs((rs) => rs.filter((r) => r.id !== hit.id));
      showToast(`Added “${p.title.slice(0, 40)}…”`);
    },

    // ---- claim verification / review screening (AI) ----
    openClaim: (task: AssessTask = "verify") => {
      setClaimTask(task);
      setClaimResult(null);
      setClaimError("");
      setClaimOpen(true);
    },
    closeClaim: () => setClaimOpen(false),
    setClaimTask: (task: AssessTask) => {
      setClaimTask(task);
      setClaimResult(null);
      setClaimError("");
    },
    runAssess: async (statement: string) => {
      const text = statement.trim();
      if (!text || claimBusy) return;
      setClaimBusy(true);
      setClaimError("");
      setClaimResult(null);
      try {
        // verify: pull the most relevant papers; screen: judge the current view.
        const pool =
          claimTask === "verify" ? retrieveForChat(papers, text, 12) : filtered.slice(0, 25);
        if (!pool.length) {
          setClaimError("No papers to assess. Add some to your library first.");
          return;
        }
        const ctx = pool.map((p) => ({
          id: p.id,
          title: p.title,
          authors: p.authors,
          year: p.year,
          abstract: p.abstract,
          summary: p.summary,
        }));
        const res = await assessLibrary(claimTask, text, ctx);
        setClaimResult(res);
      } catch (e) {
        setClaimError(e instanceof Error ? e.message : "Assessment failed");
      } finally {
        setClaimBusy(false);
      }
    },

    chatScope,
    discoverSeed,
    openDiscover: (seed?: string) => {
      setDiscoverSeed(seed ?? "");
      setScreen("discover");
    },
    hasPaper: (id: string) => papers.some((p) => p.id === id),
    chatSeed,
    chatSelection,
    openChat: () => {
      setChatScope("paper");
      setChatSeed("");
      setChatSelection("");
      setChatOpen(true);
    },
    openChatWith: (seed: string) => {
      setChatScope("paper");
      setChatSeed(seed);
      setChatSelection("");
      setChatOpen(true);
    },
    // pin a selected passage as context; question box stays empty
    openChatAboutSelection: (text: string) => {
      setChatScope("paper");
      setChatSeed("");
      setChatSelection(text);
      setChatOpen(true);
    },
    // pin a passage AND prefill a preset question (inline reading AI) — the user
    // presses Enter to run it. Used by the reader's selection popover.
    openChatPreset: (text: string, question: string) => {
      setChatScope("paper");
      setChatSeed(question);
      setChatSelection(text);
      setChatOpen(true);
    },
    clearChatSelection: () => setChatSelection(""),
    openLibraryChat: () => {
      setChatScope("library");
      setChatSeed("");
      setChatSelection("");
      setChatOpen(true);
    },
    closeChat: () => setChatOpen(false),

    finishOnboarding: () => {
      setLibrarySet(true);
      persistSettings({ librarySet: true });
      setScreen("dashboard");
    },
    closeOverlays,
    showToast,
    // Open a web URL in the system browser (native) or a new tab (web).
    openExternal: (url: string) => {
      if (!/^https?:\/\//i.test(url)) return;
      if (isTauri()) void invoke("open_url", { url }).catch(() => {});
      else window.open(url, "_blank", "noopener");
    },
  };
}

export type Store = ReturnType<typeof useStore>;
