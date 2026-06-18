import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
  renderPage,
  renderTextLayer,
  searchInPdf,
  type OutlineNode,
} from "../lib/pdf";
import { resolvePdf } from "../lib/library";
import { isTauri } from "../lib/tauri";
import { ChatPanel } from "./ChatPanel";
import { AnnPanelIcon, ChevronLeftIcon, SearchIcon, StickyIcon } from "../icons";

const BASE_WIDTH = 640;
const MAX_THUMBS = 30;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 4;
const THEMES = ["light", "sepia", "night"] as const;
type PdfTheme = (typeof THEMES)[number];

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

interface Selection {
  text: string;
  page: number;
  x: number;
  y: number;
}

export function Reader({ store: s }: { store: Store }) {
  const rp = s.readerPaper;
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
    resolvePdf(rp, s.libraryLocation, (file) => s.patchPaper(rp.id, { file }))
      .then((src) => loadPdfSource(src))
      .then(async (doc) => {
        if (!alive) return;
        setPdf(doc);
        setNumPages(doc.numPages);
        setPage(resume && resume <= doc.numPages ? resume : 1);
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

  const doSearch = async () => {
    if (!pdf) return;
    const term = window.prompt("Find in document");
    if (!term) return;
    setSearching(true);
    try {
      const found = await searchInPdf(pdf, term, page);
      if (found > 0) goToPage(found);
      else s.showToast(`“${term}” not found`);
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
          <button className="ann-toggle" onClick={doSearch} title="Find in document">
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
                const n = window.prompt(`Note for page ${page}`);
                if (n) s.addNote(rp.id, page, n);
              }}
            >
              <StickyIcon size={14} />
            </button>
          </div>
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

        <div className="reading-scroll" data-pdftheme={pdfTheme} ref={scrollRef}>
          {isMarkdown && (
            <article className="md-page chat-md">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{rp.markdown}</ReactMarkdown>
            </article>
          )}
          {!isMarkdown && loading && <div className="pdf-msg">Loading PDF…</div>}
          {!isMarkdown && error && <div className="pdf-msg">{error}</div>}
          {!isMarkdown && !loading && !error && pdf && !cont && (
            <PageView
              pdf={pdf}
              pageNum={page}
              width={width}
              highlights={rp.hl.filter((h) => h.page === page)}
              onSelect={onSelect}
              onAspect={setAspect}
              rootRef={scrollRef}
            />
          )}
          {!loading && !error && pdf && cont && (
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
            className="sel-act"
            title="Ask AI about this"
            onClick={() => {
              s.openChatAboutSelection(sel.text);
              clearSel();
            }}
          >
            ✨
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
                      const n = window.prompt("Note for this highlight", a.note || "");
                      if (n !== null) s.updateHighlight(rp.id, i, { note: n });
                    }}
                  >
                    {a.note ? "Edit note" : "+ Note"}
                  </button>
                </div>
              </div>
            ))}
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
  rootRef,
  lazy,
}: {
  pdf: PDFDocumentProxy;
  pageNum: number;
  width: number;
  highlights: Highlight[];
  onSelect: (text: string, page: number, x: number, y: number) => void;
  onAspect: (a: number) => void;
  rootRef?: RefObject<HTMLElement | null>;
  lazy?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
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
