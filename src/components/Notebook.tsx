import type { Store } from "../store";

export function Notebook({ store: s }: { store: Store }) {
  const groups = s.papers
    .filter((p) => p.hl.length)
    .map((p) => ({
      title: p.title,
      meta: `${p.authors} · ${p.year} · ${p.hl.length} highlights`,
      items: p.hl,
    }));

  return (
    <main className="page-scroll">
      <div className="page-inner notebook">
        <h1 className="page-title">Notebook</h1>
        <p className="page-sub">
          All your highlights and notes, gathered across {groups.length} papers.
        </p>
        <div className="nb-groups">
          {groups.map((g) => (
            <div key={g.title}>
              <div className="nb-group-head">
                <h2>{g.title}</h2>
                <span className="meta">{g.meta}</span>
              </div>
              <div className="nb-items">
                {g.items.map((a, i) => (
                  <div key={i} className="nb-item">
                    <span className="nb-bar" style={{ background: a.color }} />
                    <div style={{ flex: 1 }}>
                      <p className="nb-quote">{a.text}</p>
                      {a.note && <p className="nb-note">{a.note}</p>}
                      <span className="nb-page">Page {a.page}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
