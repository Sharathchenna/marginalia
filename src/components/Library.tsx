import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Store } from "../store";
import type { Paper, ReadingStatus } from "../types";
import { MoreIcon, SortIcon, StarIcon } from "../icons";
import { readingPct } from "../lib/reading";
import { articleHost, articleUrl, faviconUrl, isArticle } from "../lib/items";
import { relativeTime } from "../lib/time";

function readDotStyle(p: Paper) {
  return {
    background: p.read ? "transparent" : "var(--dot-unread)",
    boxShadow: p.read ? "inset 0 0 0 1.5px var(--text-3)" : "none",
  };
}
function starColor(fav: boolean) {
  return fav ? "var(--star)" : "var(--text-3)";
}
function effStatus(p: Paper): ReadingStatus {
  return p.status ?? (p.read ? "done" : "unread");
}

// A site favicon with a letter-badge fallback, used in article (bookmark/post) rows.
function Favicon({ host, size = 14 }: { host: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const url = faviconUrl(host);
  if (!url || failed)
    return (
      <span className="row-favicon row-favicon-fallback" style={{ width: size, height: size, lineHeight: `${size}px` }}>
        {(host[0] || "·").toUpperCase()}
      </span>
    );
  return (
    <img
      className="row-favicon"
      style={{ width: size, height: size }}
      src={url}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

// Secondary line for an article: host · reading time (or published date).
function articleMeta(p: Paper): string {
  const host = articleHost(p);
  const tail = p.readingTime
    ? `${p.readingTime} min read`
    : relativeTime(p.publishedTs ?? p.addedTs) || "";
  return [host, tail].filter(Boolean).join(" · ");
}

export function Library({ store: s }: { store: Store }) {
  const onStar = (e: MouseEvent, id: string) => {
    e.stopPropagation();
    s.toggleStar(id);
  };
  const onRead = (e: MouseEvent, id: string) => {
    e.stopPropagation();
    s.toggleRead(id);
  };
  const onRow = (e: MouseEvent, id: string) =>
    e.metaKey || e.ctrlKey ? s.toggleSel(id) : s.narrow ? s.openReader(id) : s.select(id);

  // A web-article view (bookmarks / feeds / a single feed) gets article-flavored
  // empty states and row chrome instead of the paper-centric ones.
  const webView =
    ["bookmarks", "feeds", "articles", "archived"].includes(s.filter) ||
    s.filter.startsWith("feed:");

  return (
    <main className="library">
      <section className="list-col">
        <div className="list-header">
          <h2>{s.filterTitle}</h2>
          <span className="count-pill">{s.filtered.length} {s.filterNoun}{s.filtered.length === 1 ? "" : "s"}</span>
          <div className="spacer" />
          {s.sel.length > 0 && (
            <div className="bulk-bar">
              <span>{s.sel.length} selected</span>
              <button className="mini-btn" onClick={s.bulkRead}>Mark read</button>
              <button
                className="mini-btn"
                onClick={() => {
                  void s
                    .requestPrompt({ title: "Tag selected", placeholder: "Tag name", confirmLabel: "Add tag" })
                    .then((t) => {
                      if (t && t.trim()) s.bulkAddTag(t);
                    });
                }}
              >
                Tag…
              </button>
              <button
                className="mini-btn"
                onClick={() => {
                  void s
                    .requestConfirm({ title: `Delete ${s.sel.length} items?`, confirmLabel: "Delete", danger: true })
                    .then((ok) => {
                      if (ok) s.bulkDelete();
                    });
                }}
              >
                Delete
              </button>
              <button className="mini-btn muted" onClick={s.clearSel}>Clear</button>
            </div>
          )}
          <button className="mini-btn" onClick={s.openLibraryChat} title="Chat across these papers">
            ✨ Ask library
          </button>
          <button
            className="mini-btn"
            onClick={() => s.openClaim("verify")}
            title="Verify a claim or screen papers for a review"
          >
            ✓ Verify
          </button>
          <button className="mini-btn muted" onClick={s.cycleSort}>
            <SortIcon size={12} />
            {s.sortLabel}
          </button>
        </div>

        {s.filtered.length === 0 ? (
          <div className="empty-state">
            <p className="big">Nothing here yet</p>
            <p className="small">
              {webView
                ? "Save pages with the Marginalia browser extension, paste a URL to bookmark it, or subscribe to a blog feed."
                : "Import PDFs or add a paper by DOI / arXiv ID to fill this view."}
            </p>
            <div style={{ display: "flex", gap: 9, marginTop: 16 }}>
              {webView ? (
                <>
                  <button className="btn-primary" onClick={s.openIdentifier}>Bookmark a URL</button>
                  <button className="btn-ghost" onClick={() => s.goScreen("feeds")}>
                    Subscribe to feed
                  </button>
                </>
              ) : (
                <>
                  <button className="btn-primary" onClick={s.importFiles}>Import</button>
                  <button className="btn-ghost" onClick={s.openIdentifier}>Add by ID</button>
                </>
              )}
            </div>
          </div>
        ) : s.view === "table" ? (
          <div className="table-scroll">
            <div className="table-head">
              <span />
              <span>Title</span>
              <span>Authors</span>
              <span>Year</span>
              <span>Tags</span>
            </div>
            {s.filtered.map((p) => (
              <div
                key={p.id}
                className="table-row"
                data-selected={p.id === s.selectedId}
                data-bulk={s.sel.includes(p.id)}
                onClick={(e) => onRow(e, p.id)}
              >
                <button className="star-btn" style={{ color: starColor(p.fav) }} onClick={(e) => onStar(e, p.id)}>
                  <StarIcon size={14} fill={p.fav ? "var(--star)" : "none"} />
                </button>
                <div className="title-cell">
                  <span
                    className="read-dot"
                    title="Toggle read"
                    style={readDotStyle(p)}
                    onClick={(e) => onRead(e, p.id)}
                  />
                  {isArticle(p) && <Favicon host={articleHost(p)} />}
                  <span className="cell-title" style={{ fontWeight: p.read ? 450 : 600 }}>
                    {p.retracted && (
                      <span className="retracted-flag" title={`${p.retracted.reason} notice`}>⚠ </span>
                    )}
                    {p.title}
                  </span>
                </div>
                <span className="cell-authors">{isArticle(p) ? articleHost(p) : p.authors}</span>
                <span className="cell-year">
                  {isArticle(p)
                    ? p.readingTime
                      ? `${p.readingTime}m`
                      : relativeTime(p.publishedTs ?? p.addedTs) || ""
                    : p.year || ""}
                </span>
                <div className="cell-tags">
                  {p.tags.slice(0, 2).map((tg) => (
                    <span key={tg} className="mini-tag">{tg}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card-scroll">
            {s.filtered.map((p) => (
              <div
                key={p.id}
                className="card"
                data-selected={p.id === s.selectedId}
                data-bulk={s.sel.includes(p.id)}
                onClick={(e) => onRow(e, p.id)}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <span
                    className="read-dot"
                    title="Toggle read"
                    style={{ ...readDotStyle(p), marginTop: 5 }}
                    onClick={(e) => onRead(e, p.id)}
                  />
                  <span className="card-title">
                    {isArticle(p) && <Favicon host={articleHost(p)} size={13} />}
                    {p.retracted && (
                      <span className="retracted-flag" title={`${p.retracted.reason} notice`}>⚠ </span>
                    )}
                    {p.title}
                  </span>
                  <button
                    className="star-btn"
                    style={{ color: starColor(p.fav), flex: "none", width: "auto", height: "auto" }}
                    onClick={(e) => onStar(e, p.id)}
                  >
                    <StarIcon size={14} fill={p.fav ? "var(--star)" : "none"} />
                  </button>
                </div>
                <span className="card-meta">
                  {isArticle(p) ? articleMeta(p) : `${p.authors} · ${p.year || "—"}`}
                </span>
                <span className="card-venue">{p.venue}</span>
                <div style={{ display: "flex", gap: 5, marginTop: 11, flexWrap: "wrap" }}>
                  {p.tags.slice(0, 2).map((tg) => (
                    <span key={tg} className="mini-tag">{tg}</span>
                  ))}
                </div>
                {readingPct(p) !== null && (
                  <div className="progress-track" style={{ marginTop: 10 }} title={`${readingPct(p)}% read`}>
                    <div className="progress-bar" style={{ width: `${readingPct(p)}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* On narrow viewports a row-tap opens the reader; the side detail panel is
          desktop-only. */}
      {!s.narrow && <DetailPanel store={s} />}
    </main>
  );
}

// Inline-editable text: click to edit, blur / Enter to save.
function EditableText({
  value,
  onSave,
  multiline,
  className,
  placeholder,
}: {
  value: string;
  onSave: (v: string) => void;
  multiline?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  // only resync from props when NOT editing, so a background update (e.g. an AI
  // extract finishing) doesn't wipe an in-progress edit
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  if (editing) {
    const commit = () => {
      setEditing(false);
      if (draft !== value) onSave(draft);
    };
    return multiline ? (
      <textarea
        className={`editable-input ${className ?? ""}`}
        autoFocus
        value={draft}
        rows={4}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false); // cancel without saving
          else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
        }}
      />
    ) : (
      <input
        className={`editable-input ${className ?? ""}`}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }
  return (
    <span
      className={`editable ${className ?? ""}`}
      title="Click to edit"
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
    >
      {value || <span className="editable-placeholder">{placeholder ?? "—"}</span>}
    </span>
  );
}

function DetailPanel({ store: s }: { store: Store }) {
  const cur = s.current;
  const [tagInput, setTagInput] = useState("");
  if (!cur) return <aside className="detail" />;

  const busy = s.aiBusyId === cur.id;
  const status = effStatus(cur);
  const STATUSES: { v: ReadingStatus; label: string }[] = [
    { v: "unread", label: "To read" },
    { v: "reading", label: "Reading" },
    { v: "done", label: "Done" },
  ];

  return (
    <aside className="detail">
      <div className="detail-scroll">
        <div className="detail-hero">
          <div className="detail-hero-actions">
            <button
              className="hero-icon-btn"
              title="Favorite"
              style={{ color: starColor(cur.fav) }}
              onClick={() => s.toggleStar(cur.id)}
            >
              <StarIcon size={15} fill={cur.fav ? "var(--star)" : "none"} />
            </button>
            <button
              className="hero-icon-btn"
              title="Delete paper"
              onClick={() => {
                void s
                  .requestConfirm({ title: "Delete this item?", confirmLabel: "Delete", danger: true })
                  .then((ok) => {
                    if (ok) s.deletePaper(cur.id);
                  });
              }}
            >
              <MoreIcon size={15} />
            </button>
          </div>
          <div className="pdf-chip">{isArticle(cur) ? "WEB" : "PDF"}</div>
        </div>

        <div className="detail-body">
          <h1 className="detail-title">
            <EditableText value={cur.title} onSave={(v) => s.setField(cur.id, { title: v })} />
          </h1>
          <p className="detail-authors">
            <EditableText
              value={cur.authorsFull || cur.authors}
              onSave={(v) => s.setField(cur.id, { authorsFull: v })}
              placeholder="Add authors"
            />
          </p>

          {cur.retracted && (
            <div className="retraction-banner" role="alert">
              <span className="retraction-badge">⚠ {cur.retracted.reason}</span>
              <span className="retraction-text">
                This work has a {cur.retracted.reason.toLowerCase()} notice
                {cur.retracted.date ? ` (${cur.retracted.date})` : ""}.
                {cur.retracted.url && (
                  <>
                    {" "}
                    <a
                      href={cur.retracted.url}
                      onClick={(e) => {
                        e.preventDefault();
                        s.openExternal(cur.retracted!.url);
                      }}
                    >
                      View notice
                    </a>
                  </>
                )}
              </span>
            </div>
          )}

          {/* reading status */}
          <div className="seg-group" style={{ marginTop: 12 }}>
            {STATUSES.map((st) => (
              <button
                key={st.v}
                className="seg-pill"
                data-active={status === st.v}
                onClick={() => s.setStatus(cur.id, st.v)}
              >
                {st.label}
              </button>
            ))}
          </div>

          {readingPct(cur) !== null && (
            <div className="reading-progress" title={`Page ${cur.lastPage} of ${cur.pages}`}>
              <div className="progress-track">
                <div className="progress-bar" style={{ width: `${readingPct(cur)}%` }} />
              </div>
              <span className="progress-label">
                {readingPct(cur)}% · page {cur.lastPage} of {cur.pages}
              </span>
            </div>
          )}

          <div className="detail-actions">
            <button className="btn-open" onClick={() => s.openReader(cur.id)}>
              {isArticle(cur) ? "Read article" : "Open in Reader"}
            </button>
            <button className="btn-cite" onClick={s.openChat}>Ask AI</button>
            <button className="btn-cite" onClick={s.openCite}>Cite</button>
            {isArticle(cur) && articleUrl(cur) && (
              <button className="btn-cite" onClick={() => s.openExternal(articleUrl(cur))}>
                Open original ↗
              </button>
            )}
            {isArticle(cur) && (
              <button
                className="btn-cite"
                onClick={() => (cur.archived ? s.unarchiveItem(cur.id) : s.archiveItem(cur.id))}
                title="Read-later archive: keep it but remove it from the inbox"
              >
                {cur.archived ? "Unarchive" : "Archive"}
              </button>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button className="mini-btn" disabled={busy} onClick={() => s.autoTag(cur.id)}>
              {busy ? <span className="spinner" /> : "🏷"} Auto-tag
            </button>
            {/* PDF source = a local file OR a downloadable arXiv / remote PDF.
                Extract needs a PDF; Summarize also works from just the abstract. */}
            {(cur.file || (cur.arxiv && cur.arxiv !== "—") || cur.pdfUrl) && (
              <button className="mini-btn" disabled={busy} onClick={() => s.extractMetadata(cur.id)}>
                {busy ? <span className="spinner" /> : "✨"} Extract
              </button>
            )}
            {(cur.file || (cur.arxiv && cur.arxiv !== "—") || cur.pdfUrl || cur.abstract) && (
              <button className="mini-btn" disabled={busy} onClick={() => s.summarize(cur.id)}>
                {busy ? <span className="spinner" /> : "✨"} Summarize
              </button>
            )}
            <button className="mini-btn" onClick={() => s.exportPaperMarkdown(cur.id)}>
              ↗ Obsidian
            </button>
            <button className="mini-btn" onClick={() => s.openDiscover(cur.title)}>
              🔎 Find related
            </button>
          </div>

          {cur.summary && (
            <div className="detail-section">
              <h3>Summary</h3>
              <div className="summary-box chat-md">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{cur.summary}</ReactMarkdown>
              </div>
            </div>
          )}

          <div className="detail-section">
            <h3>Abstract</h3>
            <p className="detail-abstract">
              <EditableText
                value={cur.abstract}
                onSave={(v) => s.setField(cur.id, { abstract: v })}
                multiline
                placeholder="No abstract — click ✨ Extract metadata, or add one."
              />
            </p>
          </div>

          <div className="detail-section">
            <h3>Metadata</h3>
            <div className="meta-table">
              <div className="meta-row"><span className="k">Venue</span><span className="v"><EditableText value={cur.venue} onSave={(v) => s.setField(cur.id, { venue: v })} /></span></div>
              <div className="meta-row"><span className="k">Year</span><span className="v"><EditableText value={cur.year ? String(cur.year) : ""} onSave={(v) => s.setField(cur.id, { year: Number(v) || 0 })} placeholder="—" /></span></div>
              <div className="meta-row"><span className="k">DOI</span><span className="v mono"><EditableText value={cur.doi} onSave={(v) => s.setField(cur.id, { doi: v })} /></span></div>
              <div className="meta-row"><span className="k">arXiv</span><span className="v mono"><EditableText value={cur.arxiv} onSave={(v) => s.setField(cur.id, { arxiv: v })} /></span></div>
            </div>
          </div>

          <div className="detail-section">
            <h3>Tags</h3>
            <div className="detail-tags">
              {cur.tags.map((tg) => (
                <span key={tg} className="detail-tag">
                  {tg}
                  <span className="tag-x" onClick={() => s.removeTag(cur.id, tg)}>×</span>
                </span>
              ))}
              <input
                className="tag-input"
                value={tagInput}
                placeholder="+ tag"
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && tagInput.trim()) {
                    s.addTag(cur.id, tagInput);
                    setTagInput("");
                  }
                }}
              />
            </div>
          </div>

          {cur.concepts && cur.concepts.length > 0 && (
            <div className="detail-section">
              <h3>Concepts</h3>
              <div className="detail-tags">
                {cur.concepts.map((cp) => (
                  <span
                    key={cp}
                    className="detail-tag concept"
                    title="Search papers with this concept"
                    onClick={() => {
                      s.openPalette();
                      s.setQ(cp);
                    }}
                  >
                    {cp}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="detail-section">
            <h3>Collections</h3>
            <div className="coll-checklist">
              {s.collections.map((c) => {
                const inIt = c.ids.includes(cur.id);
                return (
                  <button
                    key={c.id}
                    className="coll-check"
                    data-on={inIt}
                    onClick={() => s.togglePaperInCollection(c.id, cur.id)}
                  >
                    <span className="coll-dot" style={{ background: c.color }} />
                    {c.name.replace(/^↳\s*/, "")}
                    {inIt && <span className="coll-tick">✓</span>}
                  </button>
                );
              })}
              {s.collections.length === 0 && (
                <span style={{ fontSize: 12, color: "var(--text-3)" }}>No collections yet.</span>
              )}
            </div>
          </div>

          <div className="detail-section">
            <h3>Related</h3>
            <div className="detail-tags">
              {(cur.related ?? []).map((rid) => {
                const r = s.papers.find((x) => x.id === rid);
                if (!r) return null;
                return (
                  <span key={rid} className="detail-tag" title={r.title}>
                    {r.title.length > 24 ? r.title.slice(0, 24) + "…" : r.title}
                    <span className="tag-x" onClick={() => s.removeRelated(cur.id, rid)}>×</span>
                  </span>
                );
              })}
            </div>
            <select
              className="related-select"
              value=""
              onChange={(e) => {
                if (e.target.value) s.addRelated(cur.id, e.target.value);
              }}
            >
              <option value="">+ Link a related paper…</option>
              {s.papers
                .filter((x) => x.id !== cur.id && !(cur.related ?? []).includes(x.id))
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title.length > 50 ? x.title.slice(0, 50) + "…" : x.title}
                  </option>
                ))}
            </select>
          </div>

          {s.embedStatus.embedded > 0 && <SimilarPapers store={s} id={cur.id} />}

          <div className="detail-section">
            <h3>Notes</h3>
            <textarea
              className="notes-edit"
              value={cur.notes}
              placeholder="Your notes…"
              onChange={(e) => s.setNotes(cur.id, e.target.value)}
            />
          </div>
        </div>
      </div>
    </aside>
  );
}

// Embedding-based nearest neighbours for the selected paper (semantic search).
function SimilarPapers({ store: s, id }: { store: Store; id: string }) {
  const [items, setItems] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let alive = true;
    setItems([]);
    setLoading(true);
    s.getSimilar(id, 5)
      .then((r) => alive && setItems(r))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="detail-section">
      <h3>Similar papers</h3>
      {loading && <span className="desc" style={{ margin: 0 }}>Finding…</span>}
      {!loading && items.length === 0 && (
        <span className="desc" style={{ margin: 0 }}>None yet — build the index in Settings, or this paper isn’t indexed.</span>
      )}
      <div className="dash-list">
        {items.map((p) => (
          <button key={p.id} className="dash-item" onClick={() => s.select(p.id)}>
            <span className="dash-item-title">{p.title}</span>
            <span className="dash-item-meta">{p.authors} · {p.year || "—"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
