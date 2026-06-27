import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, RefObject } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { HL_PALETTE } from "../data";
import type { Store } from "../store";
import type { Highlight } from "../types";
import {
  destToPage,
  extractFullText,
  getOutline,
  loadPdfSource,
  paintHighlights,
  renderLinkLayer,
  renderPage,
  renderTextLayer,
  searchInPdf,
  type OutlineNode,
} from "../lib/pdf";
import { resolvePdf } from "../lib/library";
import { extractReferences } from "../lib/references";
import { articleHost, articleUrl, faviconUrl, isArticle } from "../lib/items";
import { relativeTime } from "../lib/time";
import { invoke, isTauri } from "../lib/tauri";
import { ChatPanel } from "./ChatPanel";
import { AnnPanelIcon, ChevronLeftIcon, SearchIcon, StickyIcon } from "../icons";

const BASE_WIDTH = 640;
const MAX_THUMBS = 30;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 4;
const THEMES = ["light", "sepia", "night"] as const;
type PdfTheme = (typeof THEMES)[number];
const SERIF = "'Source Serif 4', Georgia, Cambria, 'Times New Roman', serif";
const SANS_READ = "Inter, -apple-system, system-ui, sans-serif";

// Resizable side panels (persisted in localStorage).
const LEFT_MIN = 80, LEFT_MAX = 380, LEFT_DEFAULT = 108;
const RIGHT_MIN = 300, RIGHT_MAX = 680, RIGHT_DEFAULT = 380;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
function readW(key: string, def: number, lo: number, hi: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return v ? clamp(v, lo, hi) : def;
  } catch {
    return def;
  }
}
function readNum(key: string, def: number): number {
  try {
    const v = localStorage.getItem(key);
    return v != null && v !== "" ? Number(v) : def;
  } catch {
    return def;
  }
}
function readBool(key: string, def: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v == null ? def : v === "1";
  } catch {
    return def;
  }
}
// Strip Markdown/HTML to readable plain text (for text-to-speech).
function toPlainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^[#>*\-+]\s+/gm, "")
    .replace(/[*_~]+/g, "")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface Selection {
  text: string;
  page: number;
  x: number;
  y: number;
}

// Sanitize schema for clipped HTML: the GitHub default plus colspan/rowspan so
// real (spanning) tables keep their structure. Still strips scripts/handlers.
const MD_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    td: [...(defaultSchema.attributes?.td ?? []), "colSpan", "rowSpan"],
    th: [...(defaultSchema.attributes?.th ?? []), "colSpan", "rowSpan"],
  },
};

export function Reader({ store: s }: { store: Store }) {
  const rp = s.readerPaper;
  // Citable references (DOIs / arXiv ids) parsed from the cached full text.
  const references = useMemo(() => extractReferences(rp?.fulltext ?? ""), [rp?.fulltext]);
  const inLibrary = (ref: { doi?: string; arxiv?: string }) =>
    s.papers.some(
      (p) =>
        (ref.doi && p.doi === ref.doi) ||
        (ref.arxiv && p.arxiv === ref.arxiv) ||
        (ref.doi && p.id === ref.doi) ||
        (ref.arxiv && p.id === ref.arxiv),
    );
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [cont, setCont] = useState(true); // continuous scroll by default
  const [leftTab, setLeftTab] = useState<"pages" | "outline">("pages");
  const [outline, setOutline] = useState<OutlineNode[]>([]);
  const [pdfTheme, setPdfTheme] = useState<PdfTheme>("light");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const [sel, setSel] = useState<Selection | null>(null);
  const [aspect, setAspect] = useState(0.77); // width/height, updated on render
  const [pageDraft, setPageDraft] = useState("1");
  const [leftW, setLeftW] = useState(() => readW("marg.leftW", LEFT_DEFAULT, LEFT_MIN, LEFT_MAX));
  const [rightW, setRightW] = useState(() => readW("marg.rightW", RIGHT_DEFAULT, RIGHT_MIN, RIGHT_MAX));
  const scrollRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // Latest "save a figure to highlights" handler, so the memoized markdown
  // components can call it without breaking memoization (Bet B: figure highlights).
  const figureSaveRef = useRef<(src: string, alt: string) => void>(() => {});
  // resume-position restore: don't let the scroll tracker overwrite lastPage
  // until we've actually scrolled to the saved page.
  const restoredRef = useRef(false);
  const wantResume = useRef<number | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findTerm, setFindTerm] = useState("");
  // Article reading prefs (QW4 typography, Bet E reflow, Bet C TTS).
  const [mdSerif, setMdSerif] = useState(() => readBool("marg.mdSerif", true));
  const [mdSize, setMdSize] = useState(() => readNum("marg.mdSize", 18));
  const [mdWidth, setMdWidth] = useState(() => readNum("marg.mdWidth", 680));
  const [mdLeading, setMdLeading] = useState(() => readNum("marg.mdLeading", 1.7));
  const [typoOpen, setTypoOpen] = useState(false);
  const [reflow, setReflow] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  // Drag a panel edge to resize; persist the final width.
  const startResize = useCallback(
    (e: ReactMouseEvent, side: "left" | "right") => {
      e.preventDefault();
      const startX = e.clientX;
      const left0 = leftW;
      const right0 = rightW;
      const onMove = (ev: MouseEvent) => {
        if (side === "left") {
          setLeftW(clamp(left0 + (ev.clientX - startX), LEFT_MIN, LEFT_MAX));
        } else {
          setRightW(clamp(right0 - (ev.clientX - startX), RIGHT_MIN, RIGHT_MAX));
        }
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [leftW, rightW],
  );

  const paperId = rp?.id;
  const width = Math.round(BASE_WIDTH * zoom);
  // PDF-less papers (e.g. a Hugging Face card) render as Markdown instead.
  const isMarkdown = !!rp && (!rp.arxiv || rp.arxiv === "—") && !rp.file && !!rp.markdown;
  // Shared reading typography (QW4) for the Markdown article + reflowed PDF text.
  const mdStyle: CSSProperties = {
    maxWidth: mdWidth,
    fontSize: mdSize,
    lineHeight: mdLeading,
    fontFamily: mdSerif ? SERIF : SANS_READ,
  };
  // Bet E: reflow a PDF's cached full text into the single-column typography view.
  const reflowing = !isMarkdown && reflow && !!rp?.fulltext;

  const goToPage = useCallback(
    (n: number) => {
      const clamped = Math.max(1, Math.min(numPages || 1, n));
      setPage(clamped);
      if (cont) {
        requestAnimationFrame(() => {
          scrollRef.current
            ?.querySelector(`[data-page="${clamped}"]`)
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      } else {
        scrollRef.current?.scrollTo({ top: 0 });
      }
    },
    [numPages, cont],
  );

  // Open an external link from the PDF in the system browser (native) / new tab.
  const openExternal = useCallback((url: string) => {
    if (isTauri()) {
      void invoke("open_url", { url }).catch(() => window.open(url, "_blank", "noopener"));
    } else {
      window.open(url, "_blank", "noopener");
    }
  }, []);

  // Links inside a clipped/feed article must NOT navigate the webview (that would
  // replace the whole app) — open them in the system browser instead. This custom
  // anchor is applied to every link react-markdown renders, including raw HTML
  // links kept by rehype-raw.
  const mdComponents = useMemo<Components>(
    () => ({
      a({ href, children, node: _node, ...rest }) {
        const u = href ?? "";
        return (
          <a
            {...rest}
            href={href}
            onClick={(e) => {
              e.preventDefault();
              if (/^(https?:|mailto:)/i.test(u)) openExternal(u);
            }}
          >
            {children}
          </a>
        );
      },
      // Click a figure/image to save it to highlights (Bet B: highlight non-text).
      img({ src, alt, node: _node, ...rest }) {
        return (
          <img
            {...rest}
            src={typeof src === "string" ? src : undefined}
            alt={typeof alt === "string" ? alt : ""}
            loading="lazy"
            style={{ cursor: "pointer" }}
            title="Click to save this figure to your highlights"
            onClick={() => typeof src === "string" && src && figureSaveRef.current(src, typeof alt === "string" ? alt : "")}
          />
        );
      },
    }),
    [openExternal],
  );

  // Keep the figure-save handler current (read at click time, so mdComponents
  // stays memoized).
  useEffect(() => {
    figureSaveRef.current = (_src: string, alt: string) => {
      if (!rp) return;
      s.addHighlight(rp.id, `🖼 ${alt || "Figure"}`, 0, s.hl);
    };
  });

  // Persist article typography prefs.
  useEffect(() => {
    try {
      localStorage.setItem("marg.mdSerif", mdSerif ? "1" : "0");
      localStorage.setItem("marg.mdSize", String(mdSize));
      localStorage.setItem("marg.mdWidth", String(mdWidth));
      localStorage.setItem("marg.mdLeading", String(mdLeading));
    } catch {
      /* ignore */
    }
  }, [mdSerif, mdSize, mdWidth, mdLeading]);

  // Text-to-speech (Bet C): read the article aloud via the Web Speech API.
  const toggleSpeak = useCallback(() => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth || !rp) return;
    if (synth.speaking || synth.pending) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    const text = toPlainText(rp.markdown || rp.abstract || "");
    if (!text) {
      s.showToast("Nothing to read aloud", "info");
      return;
    }
    // Engines truncate very long utterances — queue sentence-sized chunks.
    const chunks: string[] = [];
    let buf = "";
    for (const part of text.match(/[^.!?]+[.!?]*\s*/g) ?? [text]) {
      if ((buf + part).length > 220) {
        if (buf) chunks.push(buf);
        buf = part;
      } else buf += part;
    }
    if (buf) chunks.push(buf);
    setSpeaking(true);
    chunks.forEach((c, i) => {
      const u = new SpeechSynthesisUtterance(c);
      if (i === chunks.length - 1) u.onend = () => setSpeaking(false);
      synth.speak(u);
    });
  }, [rp, s]);

  // Stop speech when the open item changes or the reader unmounts.
  useEffect(() => {
    setSpeaking(false);
    return () => {
      if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    };
  }, [paperId]);

  // Select-to-highlight / AI in the Markdown article (Bet B + QW2): reuse the same
  // selection popover the PDF uses (page 0 = the article body).
  const onMdMouseUp = useCallback(() => {
    const so = window.getSelection();
    const t = so?.toString().trim();
    if (t && t.length > 1 && so && so.rangeCount) {
      const r = so.getRangeAt(0).getBoundingClientRect();
      setSel({ text: t, page: 0, x: r.left + r.width / 2, y: r.top });
    }
  }, []);

  const zoomIn = useCallback(() => setZoom((z) => Math.min(MAX_ZOOM, +(z + 0.2).toFixed(2))), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(MIN_ZOOM, +(z - 0.2).toFixed(2))), []);
  const fitWidth = useCallback(() => {
    const w = scrollRef.current?.clientWidth ?? BASE_WIDTH;
    setZoom(+((w - 56) / BASE_WIDTH).toFixed(2));
  }, []);
  const fitPage = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const h = el.clientHeight - 64;
    setZoom(+((h * aspect) / BASE_WIDTH).toFixed(2));
  }, [aspect]);

  // load document; resume at last page; load outline
  useEffect(() => {
    if (!rp) return;
    let alive = true;
    setLoading(true);
    setError("");
    setPdf(null);
    setOutline([]);
    if (isMarkdown) {
      // No PDF to fetch — show the Markdown body directly.
      setNumPages(0);
      setLoading(false);
      return () => {
        alive = false;
      };
    }
    const resume = rp.lastPage;
    restoredRef.current = false;
    wantResume.current = null;
    resolvePdf(rp, s.libraryLocation, (file) => s.patchPaper(rp.id, { file }))
      .then((src) => loadPdfSource(src))
      .then(async (doc) => {
        if (!alive) return;
        setPdf(doc);
        setNumPages(doc.numPages);
        // Cache the page count so reading progress works everywhere (lists,
        // dashboard) without re-opening the PDF.
        if (rp.pages !== doc.numPages) s.patchPaper(rp.id, { pages: doc.numPages });
        const target = resume && resume <= doc.numPages ? resume : 1;
        setPage(target);
        wantResume.current = target;
        setLoading(false);
        const o = await getOutline(doc);
        if (alive) setOutline(o);
        // Cache body text once (native) for full-text search + richer AI context.
        if (alive && isTauri() && !rp.fulltext) {
          try {
            const text = await extractFullText(doc);
            if (alive && text) s.patchPaper(rp.id, { fulltext: text });
          } catch {
            /* extraction is best-effort */
          }
        }
      })
      .catch(() => {
        if (!alive) return;
        setError("Couldn't load this PDF. It may be offline or blocked.");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId, s.libraryLocation]);

  // persist reading position (both modes); keep the page input in sync
  useEffect(() => {
    if (rp && pdf && page !== rp.lastPage) s.setField(rp.id, { lastPage: page });
    setPageDraft(String(page));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // restore the saved reading position once the document is ready — continuous
  // mode needs an explicit scroll (single-page mode just renders `page`).
  useEffect(() => {
    if (!pdf || restoredRef.current) return;
    const target = wantResume.current ?? 1;
    if (!cont || target <= 1) {
      restoredRef.current = true;
      return;
    }
    const raf = requestAnimationFrame(() => {
      scrollRef.current?.querySelector(`[data-page="${target}"]`)?.scrollIntoView({ block: "start" });
      // let the programmatic scroll settle before the tracker takes over
      window.setTimeout(() => {
        restoredRef.current = true;
      }, 250);
    });
    return () => cancelAnimationFrame(raf);
  }, [pdf, cont]);

  // persist panel widths
  useEffect(() => {
    try {
      localStorage.setItem("marg.leftW", String(leftW));
    } catch {
      /* ignore */
    }
  }, [leftW]);
  useEffect(() => {
    try {
      localStorage.setItem("marg.rightW", String(rightW));
    } catch {
      /* ignore */
    }
  }, [rightW]);

  // track current page on scroll (continuous mode) + dismiss selection popover
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (sel) setSel(null);
      if (!cont) return;
      if (!restoredRef.current) return; // don't fight the resume scroll
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const top = el.getBoundingClientRect().top + 80;
        const pages = el.querySelectorAll("[data-page]");
        let best = page;
        for (const node of pages) {
          const r = (node as HTMLElement).getBoundingClientRect();
          if (r.top <= top) best = Number((node as HTMLElement).dataset.page);
        }
        if (best !== page) setPage(best);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [cont, page, sel]);

  // dismiss popover on outside mousedown
  useEffect(() => {
    if (!sel) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && popRef.current.contains(e.target as Node)) return;
      setSel(null);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [sel]);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFindOpen(true);
        return;
      }
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        goToPage(page + 1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        goToPage(page - 1);
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomIn();
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomOut();
      } else if (e.key === "0") {
        setZoom(1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [page, goToPage, zoomIn, zoomOut]);

  const runFind = async (dir: "next" | "prev") => {
    const term = findTerm.trim();
    if (!pdf || !term) return;
    setSearching(true);
    try {
      const start = dir === "next" ? page + 1 : Math.max(1, page - 1);
      let found = await searchInPdf(pdf, term, start);
      if (!found) found = await searchInPdf(pdf, term, 1); // wrap around
      if (found > 0) goToPage(found);
      else s.showToast(`“${term}” not found`, "info");
    } finally {
      setSearching(false);
    }
  };

  const onSelect = useCallback((text: string, pageNum: number, x: number, y: number) => {
    setSel({ text, page: pageNum, x, y });
  }, []);

  const openOutline = async (node: OutlineNode) => {
    if (!pdf) return;
    const pageNum = await destToPage(pdf, node.dest);
    if (pageNum > 0) goToPage(pageNum);
  };

  if (!rp) return null;

  const clearSel = () => {
    window.getSelection()?.removeAllRanges();
    setSel(null);
  };

  return (
    <main className="reader">
      {/* left panel: pages / outline */}
      <div className="thumbs" style={{ width: leftW }}>
        <div className="thumbs-head">
          <button className="back-btn" onClick={() => s.goScreen("library")}>
            <ChevronLeftIcon size={13} />
            Library
          </button>
        </div>
        <div className="left-tabs">
          <button data-active={leftTab === "pages"} onClick={() => setLeftTab("pages")}>Pages</button>
          <button data-active={leftTab === "outline"} onClick={() => setLeftTab("outline")}>Outline</button>
        </div>
        {leftTab === "pages" ? (
          <div className="thumbs-scroll">
            {pdf &&
              Array.from({ length: Math.min(numPages, MAX_THUMBS) }, (_, i) => i + 1).map((n) => (
                <Thumb key={n} pdf={pdf} pageNum={n} active={n === page} onClick={() => goToPage(n)} />
              ))}
          </div>
        ) : (
          <div className="outline-scroll">
            {outline.length === 0 ? (
              <p className="outline-empty">No outline in this PDF.</p>
            ) : (
              <OutlineTree nodes={outline} onOpen={openOutline} depth={0} />
            )}
          </div>
        )}
      </div>

      <div className="col-resizer" onMouseDown={(e) => startResize(e, "left")} title="Drag to resize" />

      {/* reading pane */}
      <section className="reading-col">
        <div className="reader-toolbar">
          <span className="reader-title">{rp.title}</span>
          <div className="spacer" />
          {isMarkdown && rp && (
            <div className="reader-article-meta">
              {rp.readingTime ? <span className="page-total">{rp.readingTime} min read</span> : null}
              {rp.publishedTs ? (
                <span className="page-total" style={{ opacity: 0.7 }}>· {relativeTime(rp.publishedTs)}</span>
              ) : null}
              <button className="ann-toggle" data-active={typoOpen} onClick={() => setTypoOpen((o) => !o)} title="Reading typography">
                Aa
              </button>
              <button className="ann-toggle" data-active={speaking} onClick={toggleSpeak} title="Listen (text-to-speech)">
                {speaking ? "■" : "▶"}
              </button>
              {articleUrl(rp) && (
                <button
                  className="btn-ghost"
                  onClick={() => openExternal(articleUrl(rp))}
                  title="Open the original page in your browser"
                >
                  Open original ↗
                </button>
              )}
              {isArticle(rp) && (
                <button
                  className="btn-ghost"
                  onClick={() => s.markDoneAndNext(rp.id)}
                  title="Mark read & archive, then open the next item"
                >
                  ✓ Done · Next
                </button>
              )}
            </div>
          )}
          {!isMarkdown && (
          <>
          <div className="pager">
            <button className="sticky-btn" disabled={page <= 1} onClick={() => goToPage(page - 1)} title="Previous (←)">‹</button>
            <input
              className="page-input"
              value={pageDraft}
              onChange={(e) => setPageDraft(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const n = Number(pageDraft);
                  if (n) goToPage(n);
                  else setPageDraft(String(page));
                  (e.target as HTMLInputElement).blur();
                }
              }}
              onBlur={() => {
                const n = Number(pageDraft);
                if (n) goToPage(n);
                else setPageDraft(String(page));
              }}
            />
            <span className="page-total">/ {numPages || "—"}</span>
            {numPages > 0 && (
              <span className="page-total" style={{ opacity: 0.7 }}>· {Math.round((page / numPages) * 100)}%</span>
            )}
            <button className="sticky-btn" disabled={page >= numPages} onClick={() => goToPage(page + 1)} title="Next (→)">›</button>
          </div>
          <div className="pager">
            <button className="sticky-btn" disabled={zoom <= MIN_ZOOM} onClick={zoomOut} title="Zoom out (−)">−</button>
            <span onClick={() => setZoom(1)} title="Reset (0)" className="zoom-pct">{Math.round(zoom * 100)}%</span>
            <button className="sticky-btn" disabled={zoom >= MAX_ZOOM} onClick={zoomIn} title="Zoom in (+)">+</button>
            <button className="fit-btn" onClick={fitWidth} title="Fit width">↔</button>
            <button className="fit-btn" onClick={fitPage} title="Fit page">⤢</button>
          </div>
          <button
            className="ann-toggle"
            onClick={() => setPdfTheme((t) => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length])}
            title={`Reading theme: ${pdfTheme}`}
          >
            {pdfTheme === "light" ? "☀" : pdfTheme === "sepia" ? "◐" : "☾"}
          </button>
          <button className="ann-toggle" data-active={cont} onClick={() => setCont((c) => !c)} title="Continuous scroll">
            {cont ? "▤" : "▥"}
          </button>
          {rp.fulltext && (
            <button
              className="ann-toggle"
              data-active={reflow}
              onClick={() => setReflow((r) => !r)}
              title="Reflow as single-column text (easier long-form reading)"
            >
              ⊟
            </button>
          )}
          {reflow && rp.fulltext && (
            <button className="ann-toggle" data-active={typoOpen} onClick={() => setTypoOpen((o) => !o)} title="Reading typography">
              Aa
            </button>
          )}
          <button
            className="ann-toggle"
            data-active={findOpen}
            onClick={() => setFindOpen((o) => !o)}
            title="Find in document (⌘F)"
          >
            {searching ? <span className="spinner" /> : <SearchIcon size={14} />}
          </button>
          <div className="hl-palette">
            {HL_PALETTE.map((h) => (
              <button
                key={h.color}
                className="hl-swatch"
                title={`Default highlight: ${h.name}`}
                onClick={() => s.setHl(h.color)}
                style={{ background: h.color, borderColor: s.hl === h.color ? "var(--text-1)" : "transparent" }}
              />
            ))}
            <span className="hl-divider" />
            <button
              className="sticky-btn"
              title="Add a note on this page"
              onClick={() => {
                void s
                  .requestPrompt({ title: `Note for page ${page}`, placeholder: "Your note", confirmLabel: "Add note" })
                  .then((n) => {
                    if (n && n.trim()) s.addNote(rp.id, page, n);
                  });
              }}
            >
              <StickyIcon size={14} />
            </button>
          </div>
          </>
          )}
          <button
            className="btn-ghost"
            data-active={s.chatOpen}
            onClick={() => (s.chatOpen ? s.closeChat() : s.openChat())}
            title="Ask AI about this paper"
          >
            Ask AI
          </button>
          <button
            className="ann-toggle"
            data-active={s.annOpen && !s.chatOpen}
            onClick={() => {
              // Chat and annotations share the right sidebar — switch between them.
              if (s.chatOpen) {
                s.closeChat();
                if (!s.annOpen) s.toggleAnn();
              } else {
                s.toggleAnn();
              }
            }}
            title="Annotations"
          >
            <AnnPanelIcon size={14} />
          </button>
        </div>

        {findOpen && (
          <div className="find-bar">
            <SearchIcon size={13} />
            <input
              autoFocus
              value={findTerm}
              placeholder="Find in document…"
              onChange={(e) => setFindTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  runFind(e.shiftKey ? "prev" : "next");
                } else if (e.key === "Escape") {
                  setFindOpen(false);
                }
              }}
            />
            <button className="sticky-btn" title="Previous match (⇧⏎)" onClick={() => runFind("prev")}>‹</button>
            <button className="sticky-btn" title="Next match (⏎)" onClick={() => runFind("next")}>›</button>
            <button className="sticky-btn" title="Close (Esc)" onClick={() => setFindOpen(false)}>×</button>
          </div>
        )}

        {typoOpen && (
          <div className="typo-pop" onMouseDown={(e) => e.stopPropagation()}>
            <div className="typo-row">
              <span className="typo-label">Font</span>
              <div className="seg-group">
                <button className="seg-pill" data-active={mdSerif} onClick={() => setMdSerif(true)}>Serif</button>
                <button className="seg-pill" data-active={!mdSerif} onClick={() => setMdSerif(false)}>Sans</button>
              </div>
            </div>
            <div className="typo-row">
              <span className="typo-label">Size</span>
              <button className="sticky-btn" onClick={() => setMdSize((v) => Math.max(13, v - 1))}>A−</button>
              <span className="typo-val">{mdSize}px</span>
              <button className="sticky-btn" onClick={() => setMdSize((v) => Math.min(28, v + 1))}>A+</button>
            </div>
            <div className="typo-row">
              <span className="typo-label">Width</span>
              <button className="sticky-btn" onClick={() => setMdWidth((v) => Math.max(520, v - 40))}>−</button>
              <span className="typo-val">{mdWidth}</span>
              <button className="sticky-btn" onClick={() => setMdWidth((v) => Math.min(900, v + 40))}>+</button>
            </div>
            <div className="typo-row">
              <span className="typo-label">Leading</span>
              <button className="sticky-btn" onClick={() => setMdLeading((v) => Math.max(1.3, +(v - 0.1).toFixed(1)))}>−</button>
              <span className="typo-val">{mdLeading.toFixed(1)}</span>
              <button className="sticky-btn" onClick={() => setMdLeading((v) => Math.min(2.2, +(v + 0.1).toFixed(1)))}>+</button>
            </div>
          </div>
        )}

        <div className="reading-scroll" data-pdftheme={pdfTheme} ref={scrollRef}>
          {isMarkdown && (
            <article className="md-page chat-md" style={mdStyle} onMouseUp={onMdMouseUp}>
              {isArticle(rp) && (
                <header className="article-head">
                  <div className="article-head-site">
                    {faviconUrl(articleHost(rp)) && (
                      <img
                        className="row-favicon"
                        src={faviconUrl(articleHost(rp))}
                        alt=""
                        onError={(e) => (e.currentTarget.style.display = "none")}
                      />
                    )}
                    <span>{articleHost(rp)}</span>
                    {rp.publishedTs ? (
                      <span className="article-head-dim">· {new Date(rp.publishedTs).toLocaleDateString()}</span>
                    ) : null}
                    {rp.readingTime ? <span className="article-head-dim">· {rp.readingTime} min read</span> : null}
                  </div>
                  <h1 className="article-head-title">{rp.title}</h1>
                  {articleUrl(rp) && (
                    <a
                      className="article-head-link"
                      href={articleUrl(rp)}
                      onClick={(e) => {
                        e.preventDefault();
                        openExternal(articleUrl(rp));
                      }}
                    >
                      {articleUrl(rp)}
                    </a>
                  )}
                </header>
              )}
              {/* rehype-raw renders HTML tables/markup that Turndown kept from a
                  clipped page; rehype-sanitize strips anything unsafe (untrusted). */}
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw, [rehypeSanitize, MD_SCHEMA]]}
                components={mdComponents}
              >
                {rp.markdown}
              </ReactMarkdown>
            </article>
          )}
          {!isMarkdown && loading && <div className="pdf-msg">Loading PDF…</div>}
          {!isMarkdown && error && <div className="pdf-msg">{error}</div>}
          {reflowing && (
            <article className="md-page" style={mdStyle} onMouseUp={onMdMouseUp}>
              <h1 className="article-head-title" style={{ marginBottom: 18 }}>{rp.title}</h1>
              {(rp.fulltext || "")
                .split(/\n{2,}/)
                .map((para) => para.trim())
                .filter(Boolean)
                .map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
            </article>
          )}
          {!isMarkdown && !reflowing && !loading && !error && pdf && !cont && (
            <PageView
              pdf={pdf}
              pageNum={page}
              width={width}
              highlights={rp.hl.filter((h) => h.page === page)}
              onSelect={onSelect}
              onAspect={setAspect}
              onLink={goToPage}
              onExternal={openExternal}
              rootRef={scrollRef}
            />
          )}
          {!reflowing && !loading && !error && pdf && cont && (
            <div className="cont-pages">
              {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
                <PageView
                  key={n}
                  pdf={pdf}
                  pageNum={n}
                  width={width}
                  highlights={rp.hl.filter((h) => h.page === n)}
                  onSelect={onSelect}
                  onAspect={setAspect}
                  onLink={goToPage}
                  onExternal={openExternal}
                  rootRef={scrollRef}
                  lazy
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* selection popover */}
      {sel && (
        <div
          ref={popRef}
          className="sel-pop"
          style={{ left: sel.x, top: Math.max(8, sel.y - 48) }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {HL_PALETTE.map((h) => (
            <button
              key={h.color}
              className="sel-swatch"
              title={`Highlight ${h.name}`}
              style={{ background: h.color }}
              onClick={() => {
                s.addHighlight(rp.id, sel.text, sel.page, h.color);
                clearSel();
              }}
            />
          ))}
          <span className="sel-div" />
          <button
            className="sel-act"
            title="Copy"
            onClick={() => {
              navigator.clipboard?.writeText(sel.text);
              s.showToast("Copied");
              clearSel();
            }}
          >
            ⧉
          </button>
          <button
            className="sel-act-text"
            title="Explain this passage in plain language"
            onClick={() => {
              s.openChatPreset(sel.text, "Explain this passage in plain language.");
              clearSel();
            }}
          >
            Explain
          </button>
          <button
            className="sel-act-text"
            title="Ask AI about this"
            onClick={() => {
              s.openChatAboutSelection(sel.text);
              clearSel();
            }}
          >
            ✨ Ask
          </button>
        </div>
      )}

      {/* right sidebar: chat takes priority when open, else annotations */}
      {(s.chatOpen || s.annOpen) && (
        <div className="col-resizer" onMouseDown={(e) => startResize(e, "right")} title="Drag to resize" />
      )}
      {s.chatOpen ? (
        <ChatPanel store={s} embedded width={rightW} />
      ) : s.annOpen ? (
        <aside className="ann-sidebar" style={{ width: rightW }}>
          <div className="ann-head">
            <span className="title">Annotations</span>
            <span className="count-pill">{rp.hl.length}</span>
            {(rp.hl.length > 0 || rp.notes.trim()) && (
              <button
                className="mini-btn muted"
                style={{ marginLeft: "auto" }}
                title="Export highlights & notes to Markdown"
                onClick={() => s.exportPaperMarkdown(rp.id)}
              >
                ↗ Export
              </button>
            )}
          </div>
          <div className="ann-scroll">
            {rp.hl.length === 0 && (
              <p style={{ fontSize: 12.5, color: "var(--text-3)", padding: "8px 2px", lineHeight: 1.5 }}>
                Select text to highlight, or use the note button to annotate a page.
              </p>
            )}
            {rp.hl.map((a, i) => (
              <div key={i} className="ann-card" style={{ borderLeft: `3px solid ${a.color}` }}>
                <button className="ann-del" title="Delete" onClick={() => s.deleteHighlight(rp.id, i)}>×</button>
                <p className="quote" onClick={() => goToPage(a.page)} style={{ cursor: "pointer" }}>"{a.text}"</p>
                {a.note && <p className="note">{a.note}</p>}
                <div className="ann-foot">
                  <span className="page-no">Page {a.page}</span>
                  <button
                    className="ann-note-btn"
                    onClick={() => {
                      void s
                        .requestPrompt({ title: "Highlight note", value: a.note || "", confirmLabel: "Save" })
                        .then((n) => {
                          if (n !== null) s.updateHighlight(rp.id, i, { note: n });
                        });
                    }}
                  >
                    {a.note ? "Edit note" : "+ Note"}
                  </button>
                </div>
              </div>
            ))}

            {references.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div className="ann-head" style={{ paddingLeft: 0 }}>
                  <span className="title">References</span>
                  <span className="count-pill">{references.length}</span>
                </div>
                <p style={{ fontSize: 11.5, color: "var(--text-3)", margin: "4px 0 8px" }}>
                  Citations detected in this paper — add them to your library or open them.
                </p>
                <div className="refs-list">
                  {references.map((ref) => (
                    <div key={ref.key} className="ref-item">
                      <span className="ref-id">{ref.label}</span>
                      <div className="ref-actions">
                        {inLibrary(ref) ? (
                          <span style={{ fontSize: 11, color: "var(--green)" }}>✓ In library</span>
                        ) : (
                          <button
                            className="mini-btn"
                            onClick={() => s.captureUrl(ref.arxiv ? `arXiv:${ref.arxiv}` : ref.doi!)}
                          >
                            + Add
                          </button>
                        )}
                        <button
                          className="mini-btn muted"
                          onClick={() =>
                            s.openExternal(
                              ref.arxiv
                                ? `https://arxiv.org/abs/${ref.arxiv}`
                                : `https://doi.org/${ref.doi}`,
                            )
                          }
                        >
                          Open
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>
      ) : null}
    </main>
  );
}

function OutlineTree({
  nodes,
  onOpen,
  depth,
}: {
  nodes: OutlineNode[];
  onOpen: (n: OutlineNode) => void;
  depth: number;
}) {
  return (
    <div className="outline-tree">
      {nodes.map((n, i) => (
        <div key={i}>
          <button className="outline-item" style={{ paddingLeft: 10 + depth * 12 }} onClick={() => onOpen(n)}>
            {n.title}
          </button>
          {n.items?.length > 0 && <OutlineTree nodes={n.items} onOpen={onOpen} depth={depth + 1} />}
        </div>
      ))}
    </div>
  );
}

function PageView({
  pdf,
  pageNum,
  width,
  highlights,
  onSelect,
  onAspect,
  onLink,
  onExternal,
  rootRef,
  lazy,
}: {
  pdf: PDFDocumentProxy;
  pageNum: number;
  width: number;
  highlights: Highlight[];
  onSelect: (text: string, page: number, x: number, y: number) => void;
  onAspect: (a: number) => void;
  onLink: (page: number) => void;
  onExternal: (url: string) => void;
  rootRef?: RefObject<HTMLElement | null>;
  lazy?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!lazy);

  useEffect(() => {
    if (!lazy || visible) return;
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { root: rootRef?.current ?? null, rootMargin: "1000px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [lazy, visible, rootRef]);

  useEffect(() => {
    if (!visible || !canvasRef.current) return;
    let alive = true;
    (async () => {
      try {
        const { viewport } = await renderPage(pdf, pageNum, canvasRef.current!, width);
        onAspect(viewport.width / viewport.height);
        if (alive && textRef.current) {
          await renderTextLayer(pdf, pageNum, textRef.current, viewport);
          paintHighlights(textRef.current, highlights);
        }
        if (alive && linkRef.current) {
          await renderLinkLayer(pdf, pageNum, linkRef.current, viewport, onLink, onExternal);
        }
      } catch {
        /* superseded — ignore */
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, pdf, pageNum, width]);

  useEffect(() => {
    if (visible && textRef.current) paintHighlights(textRef.current, highlights);
  }, [highlights, visible]);

  const onMouseUp = () => {
    const so = window.getSelection();
    const t = so?.toString().trim();
    if (t && t.length > 1 && so && so.rangeCount) {
      const r = so.getRangeAt(0).getBoundingClientRect();
      onSelect(t, pageNum, r.left + r.width / 2, r.top);
    }
  };

  return (
    <div
      className="pdf-page"
      data-page={pageNum}
      ref={wrapRef}
      onMouseUp={onMouseUp}
      style={visible ? undefined : { width, height: width * 1.3 }}
    >
      <canvas ref={canvasRef} />
      <div ref={textRef} className="textLayer" />
      <div ref={linkRef} className="linkLayer" />
    </div>
  );
}

function Thumb({
  pdf,
  pageNum,
  active,
  onClick,
}: {
  pdf: PDFDocumentProxy;
  pageNum: number;
  active: boolean;
  onClick: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) renderPage(pdf, pageNum, ref.current, 76).catch(() => {});
  }, [pdf, pageNum]);
  return (
    <div className="thumb-wrap" onClick={onClick}>
      <canvas ref={ref} className="thumb-canvas" data-active={active} />
      <span className="thumb-num" data-active={active}>{pageNum}</span>
    </div>
  );
}
