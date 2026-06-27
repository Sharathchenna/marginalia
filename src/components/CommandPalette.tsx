import { useEffect, useMemo, useRef, useState } from "react";
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

interface Action {
  id: string;
  label: string;
  hint?: string;
  kbd?: string;
  run: () => void;
}

export function CommandPalette({ store: s }: { store: Store }) {
  const q = s.q.trim();
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Every navigable action, surfaced so the palette is the one place to reach
  // (and discover the shortcut for) anything in the app.
  const actions = useMemo<Action[]>(
    () => [
      { id: "inbox", label: "Go to Inbox", hint: "Triage everything to read", run: () => s.pickFilter("queue") },
      { id: "all", label: "All Papers", run: () => s.pickFilter("all") },
      { id: "bookmarks", label: "Bookmarks", hint: "Saved articles", run: () => s.pickFilter("bookmarks") },
      { id: "feeds", label: "Blog Feeds", run: () => s.goScreen("feeds") },
      { id: "fav", label: "Favorites", run: () => s.pickFilter("fav") },
      { id: "unread", label: "Unread", run: () => s.pickFilter("unread") },
      { id: "review", label: "Daily Review", hint: "Resurface highlights & saves", run: () => s.goScreen("review") },
      { id: "discover", label: "Discover papers", run: () => s.openDiscover() },
      { id: "notebook", label: "Notebook", run: () => s.goScreen("notebook") },
      { id: "flashcards", label: "Flashcards", run: () => s.goScreen("flashcards") },
      { id: "graph", label: "Connections graph", run: () => s.goScreen("graph") },
      { id: "addid", label: "Add by DOI / arXiv / URL", kbd: "⌘N", run: () => s.openIdentifier() },
      { id: "import", label: "Import papers…", run: () => s.openImport() },
      { id: "asklib", label: "Ask your library", hint: "AI over your whole library", run: () => s.openLibraryChat() },
      { id: "retr", label: "Check for retractions", run: () => s.checkRetractions() },
      { id: "dups", label: "Find duplicates", run: () => s.openDuplicates() },
      { id: "theme", label: "Toggle light / dark theme", run: () => s.toggleTheme() },
      { id: "settings", label: "Settings", run: () => s.goScreen("settings") },
      { id: "shortcuts", label: "Keyboard shortcuts", kbd: "?", run: () => s.openShortcuts() },
    ],
    [s],
  );

  const ql = q.toLowerCase();
  const actionHits = q
    ? actions.filter((a) => (a.label + " " + (a.hint ?? "")).toLowerCase().includes(ql))
    : actions;
  // Only search the library once the user types (keeps the empty palette = a clean
  // action menu).
  const paperHits = q ? s.searchResults(s.q).slice(0, 6) : [];

  // One flat list for keyboard navigation: actions first, then papers.
  const items = [
    ...actionHits.map((a) => ({ kind: "action" as const, a })),
    ...paperHits.map((h) => ({ kind: "paper" as const, h })),
  ];

  useEffect(() => setActive(0), [s.q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (idx: number) => {
    const it = items[idx];
    if (!it) return;
    if (it.kind === "action") {
      s.closePalette();
      it.a.run();
    } else {
      s.paletteOpen(it.h.paper.id);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(active);
    }
  };

  let idx = -1;
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
            placeholder="Search papers, run a command, or jump to…"
          />
          <kbd>esc</kbd>
        </div>

        <div className="palette-results" ref={listRef}>
          {actionHits.length > 0 && <div className="palette-section">Actions</div>}
          {actionHits.map((a) => {
            idx++;
            const i = idx;
            return (
              <div
                key={a.id}
                data-idx={i}
                className={"palette-result palette-action" + (i === active ? " active" : "")}
                onMouseEnter={() => setActive(i)}
                onClick={() => run(i)}
              >
                <div className="palette-cmd-icon">⌘</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="pr-title">{a.label}</div>
                  {a.hint && <div className="pr-snip">{a.hint}</div>}
                </div>
                {a.kbd && <kbd>{a.kbd}</kbd>}
              </div>
            );
          })}

          {paperHits.length > 0 && <div className="palette-section">Papers</div>}
          {paperHits.map(({ paper, snippet }) => {
            idx++;
            const i = idx;
            return (
              <div
                key={paper.id}
                data-idx={i}
                className={"palette-result" + (i === active ? " active" : "")}
                onMouseEnter={() => setActive(i)}
                onClick={() => run(i)}
              >
                <div className="palette-pdf">PDF</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="pr-title">{paper.title}</div>
                  <div className="pr-snip">
                    <Snippet text={snippet} q={q} />
                  </div>
                </div>
                <span className="pr-year">{paper.year || ""}</span>
              </div>
            );
          })}

          {items.length === 0 && <div className="palette-empty">No matches for "{s.q}"</div>}
        </div>
      </div>
    </div>
  );
}
