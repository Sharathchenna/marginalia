import { useEffect, useRef, useState } from "react";
import { PALETTE_FILTERS } from "../data";
import type { Store } from "../store";

// Render a snippet with the first matched query token bolded — as React nodes,
// never raw HTML (the snippet is built from untrusted abstract/title text).
function Snippet({ text, q }: { text: string; q: string }) {
  const token = (q.trim().toLowerCase().split(/\s+/)[0] ?? "").replace(/^\w+:/, "");
  const i = token ? text.toLowerCase().indexOf(token) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <b style={{ color: "var(--accent)", fontWeight: 600 }}>{text.slice(i, i + token.length)}</b>
      {text.slice(i + token.length)}
    </>
  );
}

export function CommandPalette({ store: s }: { store: Store }) {
  const q = s.q.trim();
  const hits = s.searchResults(s.q).slice(0, 7);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // reset highlight to the top result whenever the query changes
  useEffect(() => setActive(0), [s.q]);
  // keep the active row scrolled into view
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(hits.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const h = hits[active];
      if (h) s.paletteOpen(h.paper.id);
    }
  };

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
            onKeyDown={onKeyDown}
            placeholder="Search papers, authors, or jump to…"
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette-filters">
          {PALETTE_FILTERS.map((f) => (
            <span
              key={f}
              className="palette-filter"
              onClick={() => s.setQ(f.endsWith(":") ? f : f + " ")}
            >
              {f}
            </span>
          ))}
        </div>
        <div className="palette-results" ref={listRef}>
          {hits.map(({ paper, snippet }, idx) => (
            <div
              key={paper.id}
              data-idx={idx}
              className={"palette-result" + (idx === active ? " active" : "")}
              onMouseEnter={() => setActive(idx)}
              onClick={() => s.paletteOpen(paper.id)}
            >
              <div className="palette-pdf">PDF</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="pr-title">{paper.title}</div>
                <div className="pr-snip">
                  <Snippet text={snippet} q={q} />
                </div>
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
