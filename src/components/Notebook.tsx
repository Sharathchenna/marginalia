import type { Store } from "../store";

export function Notebook({ store: s }: { store: Store }) {
  const groups = s.papers
    .filter((p) => p.hl.length || p.notes.trim())
    .map((p) => ({
      id: p.id,
      title: p.title,
      meta: `${p.authors} · ${p.year} · ${p.hl.length} highlight${p.hl.length === 1 ? "" : "s"}`,
      notes: p.notes.trim(),
      items: p.hl,
    }));

  return (
    <main className="page-scroll">
      <div className="page-inner notebook">
        <h1 className="page-title">Notebook</h1>
        <p className="page-sub">
          All your highlights and notes, gathered across {groups.length} paper{groups.length === 1 ? "" : "s"}.
        </p>
        {groups.length > 0 && (
          <div style={{ display: "flex", gap: 9, marginBottom: 18 }}>
            <button className="mini-btn" onClick={s.exportLibraryMarkdown}>
              ↗ Export all notes (Markdown)
            </button>
          </div>
        )}
        {groups.length === 0 ? (
          <div className="fc-empty">
            Highlight passages or jot notes while reading — they all collect here.
          </div>
        ) : (
          <div className="nb-groups">
            {groups.map((g) => (
              <div key={g.id}>
                <div className="nb-group-head">
                  <h2>{g.title}</h2>
                  <span className="meta">{g.meta}</span>
                  <button
                    className="mini-btn muted"
                    style={{ marginLeft: "auto" }}
                    title="Export this paper's notes to Markdown"
                    onClick={() => s.exportPaperMarkdown(g.id)}
                  >
                    ↗ Export
                  </button>
                </div>
                <div className="nb-items">
                  {g.notes && (
                    <div className="nb-item">
                      <span className="nb-bar" style={{ background: "var(--accent)" }} />
                      <div style={{ flex: 1 }}>
                        <p className="nb-note" style={{ marginTop: 0 }}>📝 {g.notes}</p>
                      </div>
                    </div>
                  )}
                  {g.items.map((a, i) => (
                    <button
                      key={i}
                      className="nb-item nb-item-btn"
                      title="Open in reader"
                      onClick={() => s.openReader(g.id)}
                    >
                      <span className="nb-bar" style={{ background: a.color }} />
                      <div style={{ flex: 1 }}>
                        <p className="nb-quote">{a.text}</p>
                        {a.note && <p className="nb-note">{a.note}</p>}
                        <span className="nb-page">Page {a.page}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
