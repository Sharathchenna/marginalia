import { PALETTE_FILTERS } from "../data";
import type { Store } from "../store";

// Bold the first matched query token inside a snippet (returns HTML).
function highlight(text: string, q: string): string {
  const token = q.trim().toLowerCase().split(/\s+/)[0];
  if (!token) return text;
  const i = text.toLowerCase().indexOf(token);
  if (i < 0) return text;
  return (
    text.slice(0, i) +
    '<b style="color:var(--accent);font-weight:600">' +
    text.slice(i, i + token.length) +
    "</b>" +
    text.slice(i + token.length)
  );
}

export function CommandPalette({ store: s }: { store: Store }) {
  const q = s.q.trim();
  const hits = s.searchResults(s.q).slice(0, 7);

  return (
    <div className="scrim top" onClick={s.closeOverlays}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input-row">
          <svg width="17" height="17" viewBox="0 0 16 16" fill="none" style={{ color: "var(--text-3)" }}>
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
            <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="currentColor" strokeWidth="1.4" />
          </svg>
          <input
            autoFocus
            value={s.q}
            onChange={(e) => s.setQ(e.target.value)}
            placeholder="Search papers, authors, or jump to…"
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette-filters">
          {PALETTE_FILTERS.map((f) => (
            <span key={f} className="palette-filter" onClick={() => s.setQ(f.replace(/[:].*/, ""))}>
              {f}
            </span>
          ))}
        </div>
        <div className="palette-results">
          {hits.map(({ paper, snippet }) => (
            <div key={paper.id} className="palette-result" onClick={() => s.paletteOpen(paper.id)}>
              <div className="palette-pdf">PDF</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="pr-title">{paper.title}</div>
                <div
                  className="pr-snip"
                  dangerouslySetInnerHTML={{
                    __html: q ? highlight(snippet, q) : snippet,
                  }}
                />
              </div>
              <span className="pr-year">{paper.year}</span>
            </div>
          ))}
          {q && hits.length === 0 && (
            <div className="palette-empty">No matches for "{s.q}"</div>
          )}
        </div>
      </div>
    </div>
  );
}
