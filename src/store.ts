import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CiteStyle,
  Collection,
  Density,
  Filter,
  Paper,
  Screen,
  SortKey,
  Theme,
  ViewMode,
} from "./types";
import { repo, type Settings } from "./lib/repo";
import { invoke, isTauri, detectGlassPlatform } from "./lib/tauri";
import {
  chooseLibraryFolder,
  importPdf,
  pickPdfFiles,
  scanLibrary,
} from "./lib/library";
import type { ScannedPdf } from "./lib/library";
import { lookupIdentifier } from "./lib/metadata";
import { autoTag as agentAutoTag, extractMetadata, summarizePaper } from "./lib/agent";
import type { AutoTagResult } from "./lib/agent";
import { exportLibrary as exportLibraryMd, exportPaper as exportPaperMd } from "./lib/markdown";
import { parseBibliography } from "./lib/citation";
import { searchPapers } from "./lib/search";

// Native window-material the current platform supports (computed once).
const GLASS_PLATFORM = detectGlassPlatform();

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
  queue: "Reading Queue",
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
      const [ps, cs, st] = await Promise.all([
        r.listPapers(),
        r.listCollections(),
        r.getSettings(),
      ]);
      if (!alive) return;
      setPapers(ps);
      setCollections(cs);
      setThemeState(st.theme);
      setDensityState(st.density);
      setViewState(st.view);
      setDefaultCite(st.defaultCite);
      setCiteStyle(st.defaultCite);
      setLibraryLocation(st.libraryLocation);
      setWatchFolders(st.watchFolders);
      setLibrarySet(st.librarySet);
      if (typeof st.glass === "boolean") setGlassState(st.glass);
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

  // native only: start watching folders and surface new-PDF events
  useEffect(() => {
    if (!loaded || !isTauri()) return;
    let unlisten = () => {};
    void invoke("start_watch", { folders: watchFolders }).catch(() => {});
    import("@tauri-apps/api/event").then(({ listen }) =>
      listen<string>("watch-import", () =>
        setToast("New PDF detected in a watch folder"),
      ).then((u) => {
        unlisten = u;
      }),
    );
    return () => unlisten();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const persistSettings = useCallback(
    (patch: Partial<Settings>) => {
      void r.saveSettings(patch);
    },
    [r],
  );

  const showToast = useCallback((msg: string) => setToast(msg), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const closeOverlays = useCallback(() => {
    setPalette(false);
    setImportOpen(false);
    setIdOpen(false);
    setCiteOpen(false);
  }, []);

  const filtered = useMemo(() => {
    const effStatus = (p: Paper) => p.status ?? (p.read ? "done" : "unread");
    let list = papers;
    if (filter === "all") list = papers;
    else if (filter === "recent") list = papers.filter((p) => p.addedTs >= 190);
    else if (filter === "fav") list = papers.filter((p) => p.fav);
    else if (filter === "unread") list = papers.filter((p) => !p.read);
    else if (filter === "queue") list = papers.filter((p) => effStatus(p) !== "done");
    else if (filter.startsWith("tag:")) {
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
      // currently-reading first, then to-read
      sorted.sort((a, b) => (effStatus(a) === "reading" ? 0 : 1) - (effStatus(b) === "reading" ? 0 : 1));
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setIdText("");
        setIdError("");
        setIdOpen(true);
      } else if (e.key === "Escape") {
        closeOverlays();
      } else if (
        (e.key === "ArrowDown" || e.key === "ArrowUp") &&
        screen === "library" &&
        !palette
      ) {
        e.preventDefault();
        moveSel(e.key === "ArrowDown" ? 1 : -1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [screen, palette, moveSel, closeOverlays]);

  // ----- mutations (write-through to the repo) -----
  const patchPaper = useCallback(
    (id: string, patch: Partial<Paper>) => {
      setPapers((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
      void r.updatePaper(id, patch);
    },
    [r],
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
        patchPaper(id, { read: !p.read });
        showToast("Toggled read status");
      }
    },
    [papers, patchPaper, showToast],
  );

  const addPaper = useCallback(
    (p: Paper) => {
      setPapers((ps) => [p, ...ps.filter((x) => x.id !== p.id)]);
      void r.addPaper(p);
    },
    [r],
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

  const persistCollections = useCallback(
    (next: Collection[]) => {
      setCollections(next);
      void r.saveCollections(next);
    },
    [r],
  );

  const pdfPathFor = useCallback(
    (p: Paper): string | undefined =>
      p.file ? `${libraryLocation.replace(/\/+$/, "")}/${p.file}` : undefined,
    [libraryLocation],
  );

  const current = papers.find((p) => p.id === selectedId);
  const readerPaper = papers.find((p) => p.id === readerId) || current;

  const filterTitle = (() => {
    if (FILTER_TITLE[filter]) return FILTER_TITLE[filter];
    if (filter.startsWith("tag:")) return "#" + filter.slice(4);
    const c = collections.find((c) => c.id === filter);
    return c ? c.name : "Papers";
  })();

  return {
    // state
    loaded,
    theme,
    density,
    view,
    defaultCite,
    libraryLocation,
    watchFolders,
    glass,
    glassMode: (glass ? GLASS_PLATFORM : "off") as "full" | "acrylic" | "off",
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
    chatOpen,
    papers,
    collections,

    // derived
    filtered,
    current,
    readerPaper,
    filterTitle,
    sortLabel: SORT_LABEL[sortKey],
    showSidebar: sidebar && screen !== "reader",
    counts: {
      all: papers.length,
      recent: papers.filter((p) => p.addedTs >= 190).length,
      fav: papers.filter((p) => p.fav).length,
      unread: papers.filter((p) => !p.read).length,
      queue: papers.filter((p) => (p.status ?? (p.read ? "done" : "unread")) !== "done").length,
      untagged: papers.filter((p) => p.tags.length === 0).length,
    },

    // settings actions (persisted)
    glassSupported: GLASS_PLATFORM !== "off",
    setGlass: (on: boolean) => {
      setGlassState(on);
      persistSettings({ glass: on });
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
    addWatchFolder: (path: string) => {
      if (watchFolders.includes(path)) return; // no dup keys / double-remove
      const next = [...watchFolders, path];
      setWatchFolders(next);
      persistSettings({ watchFolders: next });
      if (isTauri()) void invoke("start_watch", { folders: next }).catch(() => {});
      showToast("Watch folder added");
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
            addedTs: 230,
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
      setFilter(f);
      setScreen("library");
    },
    goScreen: setScreen,
    select: setSelectedId,
    setSel,
    toggleSel: (id: string) =>
      setSel((cur) =>
        cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
      ),
    clearSel: () => setSel([]),
    bulkRead: () => {
      const ids = sel;
      setPapers((ps) =>
        ps.map((p) => (ids.includes(p.id) ? { ...p, read: true } : p)),
      );
      ids.forEach((id) => void r.updatePaper(id, { read: true }));
      setSel([]);
      showToast(`${ids.length} papers marked read`);
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
    setStatus: (id: string, status: Paper["status"]) =>
      patchPaper(id, { status, read: status === "done" }),
    deletePaper: (id: string) => {
      // strip dangling related back-references in other papers
      setPapers((ps) =>
        ps
          .filter((p) => p.id !== id)
          .map((p) =>
            p.related?.includes(id) ? { ...p, related: p.related.filter((x) => x !== id) } : p,
          ),
      );
      void r.deletePaper(id);
      papers.forEach((p) => {
        if (p.id !== id && p.related?.includes(id)) {
          void r.updatePaper(p.id, { related: p.related.filter((x) => x !== id) });
        }
      });
      // drop from any collection
      const next = collections.map((c) => ({ ...c, ids: c.ids.filter((x) => x !== id) }));
      if (next.some((c, i) => c.ids.length !== collections[i].ids.length)) persistCollections(next);
      setSel((cur) => cur.filter((x) => x !== id));
      // reselect the neighbour in the current view, not an arbitrary paper
      if (selectedId === id) {
        const view = filtered.filter((p) => p.id !== id);
        const idx = filtered.findIndex((p) => p.id === id);
        const neighbour = view[Math.min(idx, view.length - 1)] ?? view[0];
        if (neighbour) setSelectedId(neighbour.id);
      }
      showToast("Paper deleted");
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

    // ---- full backup (JSON) ----
    exportBackup: () => {
      const data = {
        version: 1,
        papers,
        collections,
        settings: { theme, density, view, defaultCite, libraryLocation, watchFolders, glass },
      };
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "marginalia-backup.json";
      a.click();
      URL.revokeObjectURL(url);
      showToast("Backup downloaded");
    },
    importBackup: (text: string) => {
      try {
        const data = JSON.parse(text);
        if (Array.isArray(data.papers)) {
          setPapers(data.papers);
          void r.replacePapers(data.papers); // replace, not append (no stale rows on reload)
          if (data.papers[0]) setSelectedId(data.papers[0].id);
        }
        if (Array.isArray(data.collections)) persistCollections(data.collections);
        if (data.settings) {
          const st = data.settings;
          if (st.theme) setThemeState(st.theme);
          if (st.density) setDensityState(st.density);
          if (st.view) setViewState(st.view);
          if (st.defaultCite) setDefaultCite(st.defaultCite);
          if (st.libraryLocation) setLibraryLocation(st.libraryLocation);
          if (Array.isArray(st.watchFolders)) setWatchFolders(st.watchFolders);
          if (typeof st.glass === "boolean") setGlassState(st.glass);
          void r.saveSettings(st);
        }
        showToast("Library restored");
      } catch {
        showToast("Couldn't read backup file");
      }
    },

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
      patchPaper(paperId, { hl: p.hl.filter((_, i) => i !== index) });
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
      ids.forEach((id) => void r.deletePaper(id));
      papers.forEach((p) => {
        if (!idSet.has(p.id) && p.related?.some((x) => idSet.has(x))) {
          void r.updatePaper(p.id, { related: p.related.filter((x) => !idSet.has(x)) });
        }
      });
      persistCollections(
        collections.map((c) => ({ ...c, ids: c.ids.filter((x) => !idSet.has(x)) })),
      );
      setSel([]);
      showToast(`Deleted ${ids.length} papers`);
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
      const pdf = p && pdfPathFor(p);
      if (!p || !pdf) {
        showToast("No local PDF to read for this paper.");
        return;
      }
      setAiBusyId(id);
      try {
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
        showToast(e instanceof Error ? e.message : "Extraction failed");
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
        enrich(patch, p, m);
        patchPaper(id, patch);
        // Auto-file into a collection named after the AI category.
        if (m.category) persistCollections(fileInCategory(collections, m.category, id));
        showToast(m.category ? `Filed in “${m.category}” ✨` : "Categorised ✨");
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Tagging failed");
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
      await summarizePaper(p, pdfPathFor(p), {
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
          showToast(msg);
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
        showToast("Copy failed — select and copy manually");
      }
      setCiteOpen(false);
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
  };
}

export type Store = ReturnType<typeof useStore>;
