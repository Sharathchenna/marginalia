import { useEffect, useRef, useState } from "react";
import { exportLibrary } from "../lib/citation";
import { CITE_STYLE_OPTIONS } from "../lib/csl";
import { isTauri } from "../lib/tauri";
import type { Store } from "../store";
import type { Density } from "../types";
import { FolderIcon } from "../icons";

const EMBED_MODELS = ["voyage-3.5-lite", "voyage-3.5"];

const DENSITIES: Density[] = ["compact", "comfortable"];

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// The bookmarklet must carry a `javascript:` href, which React refuses to render
// directly — set it on the anchor via a ref so it stays draggable to the bookmarks bar.
function Bookmarklet({ port, onCopy }: { port: number; onCopy: (code: string) => void }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const code = `javascript:(function(){window.open('http://127.0.0.1:${port}/add?u='+encodeURIComponent(location.href),'marg','width=380,height=180')})()`;
  useEffect(() => {
    if (ref.current) ref.current.setAttribute("href", code);
  }, [code]);
  return (
    <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
      <a ref={ref} className="mini-btn" draggable onClick={(e) => e.preventDefault()}>
        + Save to Marginalia
      </a>
      <button className="mini-btn muted" onClick={() => onCopy(code)}>
        Copy bookmarklet
      </button>
    </div>
  );
}

// Optional user-hosted WebDAV sync (Nextcloud, Fastmail, self-hosted…). Local
// state so typing isn't persisted on every keystroke; saved on blur / sync.
function WebdavSync({ store: s }: { store: Store }) {
  const [url, setUrl] = useState(s.webdavUrl);
  const [user, setUser] = useState(s.webdavUser);
  const [pass, setPass] = useState(s.webdavPass);
  const save = () => s.setWebdav(url.trim(), user.trim(), pass);
  return (
    <div>
      <h3>Sync (WebDAV)</h3>
      <p className="desc">
        Cross-device sync via your own WebDAV server — Nextcloud, Fastmail, a self-hosted
        box. Point at a snapshot file URL (e.g.{" "}
        <span className="mono">https://dav.example.com/marginalia.json</span>). Your data never
        touches a Marginalia server.
      </p>
      <input
        className="id-input"
        placeholder="https://dav.example.com/marginalia.json"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onBlur={save}
      />
      <div style={{ display: "flex", gap: 9, marginTop: 9 }}>
        <input
          className="id-input"
          style={{ flex: 1 }}
          placeholder="Username (optional)"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          onBlur={save}
        />
        <input
          className="id-input"
          style={{ flex: 1 }}
          type="password"
          placeholder="Password / app token"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          onBlur={save}
        />
      </div>
      <div style={{ display: "flex", gap: 9, marginTop: 10, alignItems: "center" }}>
        <button className="mini-btn" disabled={s.syncing || !url.trim()} onClick={() => { save(); void s.syncToWebdav(); }}>
          {s.syncing ? <span className="spinner" /> : "↑"} Push to server
        </button>
        <button className="mini-btn" disabled={s.syncing || !url.trim()} onClick={() => { save(); void s.syncFromWebdav(); }}>
          {s.syncing ? <span className="spinner" /> : "↓"} Pull from server
        </button>
      </div>
    </div>
  );
}

export function Settings({ store: s }: { store: Store }) {
  const restoreRef = useRef<HTMLInputElement>(null);
  return (
    <main className="page-scroll">
      <div className="page-inner settings">
        <h1 className="page-title">Settings</h1>
        <div className="settings-list">
          <div>
            <h3>Library location</h3>
            <p className="desc">Where your PDFs and database live. Everything is stored locally.</p>
            <div className="field-row">
              <FolderIcon size={16} style={{ color: "var(--text-3)" }} />
              <span className="path">{s.libraryLocation}</span>
              <button className="change" onClick={s.chooseLibrary}>Change…</button>
            </div>
            <div style={{ display: "flex", gap: 9, marginTop: 9 }}>
              <button className="mini-btn" onClick={s.rescanLibrary}>
                Scan folder for PDFs
              </button>
            </div>
          </div>

          <div>
            <h3>Watch folders</h3>
            <p className="desc">New PDFs dropped here are imported automatically.</p>
            <div className="watch-list">
              {s.watchFolders.map((w) => (
                <div key={w} className="watch-item">
                  <span className="dot" />
                  <span className="path">{w}</span>
                  <span className="more" title="Remove" onClick={() => s.removeWatchFolder(w)}>×</span>
                </div>
              ))}
              <button
                className="watch-add"
                onClick={() => {
                  const next = window.prompt("Folder to watch", "~/Downloads");
                  if (next) s.addWatchFolder(next);
                }}
              >
                + Add folder…
              </button>
            </div>
          </div>

          {isTauri() && s.capturePort > 0 && (
            <div>
              <h3>Web capture</h3>
              <p className="desc">
                Drag this button to your browser’s bookmarks bar (or copy it as a new
                bookmark). Click it on any paper page — arXiv, a journal site, a DOI link,
                Hugging Face — to send it straight into your library.
              </p>
              <Bookmarklet
                port={s.capturePort}
                onCopy={(code) => {
                  void navigator.clipboard
                    .writeText(code)
                    .then(() => s.showToast("Bookmarklet copied — make a new bookmark and paste it as the URL"))
                    .catch(() => s.showToast("Copy failed", "error"));
                }}
              />
            </div>
          )}

          <div>
            <h3>Appearance</h3>
            <div className="theme-cards">
              <button className="theme-card" data-active={s.theme === "light"} onClick={() => s.setTheme("light")}>
                <div className="swatch" style={{ background: "#fff", border: "1px solid #E8E8EC" }}>
                  <span style={{ width: "30%", background: "#F3F3F5", borderRight: "1px solid #E8E8EC" }} />
                </div>
                <span className="label">Light</span>
              </button>
              <button className="theme-card" data-active={s.theme === "dark"} onClick={() => s.setTheme("dark")}>
                <div className="swatch" style={{ background: "#151518", border: "1px solid #2a2a30" }}>
                  <span style={{ width: "30%", background: "#1f1f24", borderRight: "1px solid #2a2a30" }} />
                </div>
                <span className="label">Dark</span>
              </button>
            </div>
            {s.glassSupported && (
              <div style={{ marginTop: 16 }}>
                <h3 style={{ marginBottom: 2 }}>Translucent interface</h3>
                <p className="desc">
                  Use the real macOS window material (Liquid Glass on macOS&nbsp;26)
                  behind the sidebars and title bar.
                </p>
                <div className="seg-group">
                  <button className="seg-pill" data-active={s.glass} onClick={() => s.setGlass(true)}>
                    On
                  </button>
                  <button className="seg-pill" data-active={!s.glass} onClick={() => s.setGlass(false)}>
                    Off
                  </button>
                </div>
              </div>
            )}
          </div>

          <div>
            <h3>Density</h3>
            <p className="desc">Row spacing in the paper list.</p>
            <div className="seg-group">
              {DENSITIES.map((d) => (
                <button
                  key={d}
                  className="seg-pill"
                  data-active={s.density === d}
                  onClick={() => s.setDensity(d)}
                  style={{ textTransform: "capitalize" }}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3>Default citation style</h3>
            <p className="desc">Used when copying references and building bibliographies.</p>
            <div className="seg-group" style={{ flexWrap: "wrap" }}>
              {CITE_STYLE_OPTIONS.map((cs) => (
                <button
                  key={String(cs.id)}
                  className="seg-pill"
                  data-active={s.defaultCite === cs.id}
                  onClick={() => s.setDefaultCite(cs.id)}
                >
                  {cs.label}
                </button>
              ))}
            </div>
          </div>

          {isTauri() && (
            <div>
              <h3>Semantic search</h3>
              <p className="desc">
                Embeddings power “Similar papers” and smarter library Q&amp;A. Paste a free{" "}
                <a href="https://www.voyageai.com" target="_blank" rel="noreferrer">Voyage AI</a>{" "}
                key, then build the index. Your papers’ text is sent to Voyage only when you build
                it — nothing leaves your machine otherwise.
              </p>
              <input
                className="id-input"
                type="password"
                placeholder="Voyage API key (pa-…)"
                value={s.voyageKey}
                onChange={(e) => s.setVoyageKey(e.target.value.trim())}
              />
              <div className="seg-group" style={{ marginTop: 9 }}>
                {EMBED_MODELS.map((mm) => (
                  <button
                    key={mm}
                    className="seg-pill"
                    data-active={s.embedModel === mm}
                    onClick={() => s.setEmbedModel(mm)}
                  >
                    {mm}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 9, marginTop: 10, alignItems: "center" }}>
                <button className="mini-btn" disabled={s.indexing || !s.voyageKey} onClick={s.buildIndex}>
                  {s.indexing ? <span className="spinner" /> : "Build index"}
                </button>
                <span className="desc" style={{ margin: 0 }}>
                  {s.embedStatus.embedded} of {s.papers.length} papers indexed
                </span>
              </div>
            </div>
          )}

          <div>
            <h3>Library</h3>
            <p className="desc">{s.papers.length} papers. Export or import your whole library.</p>
            <div style={{ display: "flex", gap: 9 }}>
              <button
                className="mini-btn"
                onClick={() => download("marginalia.bib", exportLibrary(s.papers, "bibtex"))}
              >
                Export BibTeX
              </button>
              <button
                className="mini-btn"
                onClick={() => download("marginalia.ris", exportLibrary(s.papers, "ris"))}
              >
                Export RIS
              </button>
              <button className="mini-btn" onClick={s.openImport}>
                Import…
              </button>
              <button className="mini-btn" onClick={s.exportLibraryMarkdown}>
                Export to Obsidian (Markdown)
              </button>
            </div>
          </div>

          <div>
            <h3>Data quality</h3>
            <p className="desc">
              Check your library against Crossref’s Retraction Watch data (one DOI per
              query — nothing else about your library is sent), and find duplicate papers.
            </p>
            <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
              <button className="mini-btn" onClick={s.checkRetractions}>
                Check for retractions
              </button>
              <button className="mini-btn" onClick={s.openDuplicates}>
                Find duplicates
              </button>
              {s.counts.retracted > 0 && (
                <span className="desc" style={{ margin: 0, color: "var(--danger)" }}>
                  ⚠ {s.counts.retracted} retracted
                </span>
              )}
            </div>
            <div style={{ marginTop: 14 }}>
              <h3 style={{ marginBottom: 2 }}>Auto-export BibTeX</h3>
              <p className="desc">
                Keep a <span className="mono">library.bib</span> in your library folder up to
                date on every change — point LaTeX / Overleaf at it.
              </p>
              <div className="seg-group">
                <button className="seg-pill" data-active={s.autoBib} onClick={() => s.setAutoBib(true)}>
                  On
                </button>
                <button className="seg-pill" data-active={!s.autoBib} onClick={() => s.setAutoBib(false)}>
                  Off
                </button>
                <button className="mini-btn" style={{ marginLeft: 8 }} onClick={s.exportBibNow}>
                  Export library.bib now
                </button>
              </div>
            </div>
          </div>

          {isTauri() && <WebdavSync store={s} />}

          <div>
            <h3>Backup &amp; restore</h3>
            <p className="desc">Save or restore your whole library (papers, collections, settings) as a JSON file.</p>
            <div style={{ display: "flex", gap: 9 }}>
              <button className="mini-btn" onClick={s.exportBackup}>Download backup</button>
              <button className="mini-btn" onClick={() => restoreRef.current?.click()}>Restore…</button>
              <input
                ref={restoreRef}
                type="file"
                accept=".json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) f.text().then((t) => s.importBackup(t));
                  e.target.value = "";
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
