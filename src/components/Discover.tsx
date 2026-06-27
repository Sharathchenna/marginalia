import { useEffect, useState } from "react";
import type { Store } from "../store";
import {
  federatedSearch,
  hitToPaper,
  serverFeed,
  SOURCES,
  trendingHuggingFace,
  type DiscoverHit,
  type SourceId,
} from "../lib/discover";

const SOURCE_LABEL: Record<SourceId, string> = {
  openalex: "OpenAlex",
  semanticscholar: "S2",
  arxiv: "arXiv",
  crossref: "Crossref",
  huggingface: "HF",
};

// Find new papers across multiple scholarly sources and add them to the library.
export function Discover({ store: s }: { store: Store }) {
  const [query, setQuery] = useState(s.discoverSeed);
  const [sources, setSources] = useState<Set<SourceId>>(
    () => new Set(SOURCES.map((x) => x.id)),
  );
  const [results, setResults] = useState<DiscoverHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ran, setRan] = useState(false);

  const run = async (q: string) => {
    const term = q.trim();
    if (!term || sources.size === 0) return;
    setBusy(true);
    setError("");
    setRan(true);
    try {
      setResults(await federatedSearch(term, [...sources]));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
      setResults([]);
    } finally {
      setBusy(false);
    }
  };

  const trending = async () => {
    setBusy(true);
    setError("");
    setRan(true);
    try {
      // Prefer the server's curated feed (adds the inLibrary signal + parity with
      // iOS) when a self-hosted server is configured; else fetch HF directly.
      setResults(s.apiToken ? await serverFeed(s.apiUrl, s.apiToken) : await trendingHuggingFace());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load trending");
      setResults([]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (s.discoverSeed) run(s.discoverSeed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.discoverSeed]);

  const toggleSource = (id: SourceId) =>
    setSources((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <main className="page-scroll">
      <div className="page-inner" style={{ maxWidth: 780 }}>
        <h1 className="page-title">Discover</h1>
        <p className="page-sub">
          Search across scholarly sources and add papers to your library. arXiv
          results are readable in the app immediately.
        </p>

        <div className="discover-search">
          <input
            value={query}
            autoFocus
            placeholder="Search papers, topics, authors…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run(query)}
          />
          <button className="btn-go" onClick={() => run(query)} disabled={busy || !query.trim() || sources.size === 0}>
            {busy ? <span className="spinner" /> : "Search"}
          </button>
        </div>

        <div className="discover-trending">
          <button className="link-btn" onClick={trending} disabled={busy}>
            🔥 Trending on Hugging Face
          </button>
        </div>

        <div className="source-chips">
          {SOURCES.map((src) => (
            <button
              key={src.id}
              className="source-chip"
              data-on={sources.has(src.id)}
              onClick={() => toggleSource(src.id)}
            >
              {src.label}
            </button>
          ))}
        </div>

        {error && <div className="chat-error" style={{ marginTop: 16 }}>{error}</div>}

        <div className="discover-results">
          {ran && !busy && results.length === 0 && !error && <div className="fc-empty">No results.</div>}
          {results.map((h) => {
            const p = hitToPaper(h);
            const added = s.hasPaper(p.id);
            return (
              <div key={h.source + ":" + h.id} className="discover-card">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="discover-title">{h.title}</div>
                  <div className="discover-meta">
                    {h.authorsShort} · {h.year || "—"} · {h.venue}
                    {h.citedBy > 0 && ` · ${h.citedBy.toLocaleString()} citations`}
                  </div>
                  {h.tldr && <div className="discover-tldr">TL;DR {h.tldr}</div>}
                  {!h.tldr && h.abstract && (
                    <div className="discover-abstract">{h.abstract.slice(0, 220)}…</div>
                  )}
                  <div className="discover-badges">
                    {(h.sources ?? [h.source]).map((sid) => (
                      <span key={sid} className="src-badge">{SOURCE_LABEL[sid]}</span>
                    ))}
                    {h.arxiv !== "—" && <span className="src-badge pdf">PDF</span>}
                  </div>
                </div>
                <button className="mini-btn" disabled={added} onClick={() => s.addPaper(p)}>
                  {added ? "✓ Added" : "+ Add"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
