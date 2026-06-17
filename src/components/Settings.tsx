import { useRef } from "react";
import { exportLibrary } from "../lib/citation";
import type { Store } from "../store";
import type { CiteStyle, Density } from "../types";
import { FolderIcon } from "../icons";

const CITE_STYLES: CiteStyle[] = ["APA", "MLA", "Chicago", "BibTeX"];
const DENSITIES: Density[] = ["compact", "comfortable"];

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
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
            <div className="seg-group">
              {CITE_STYLES.map((cs) => (
                <button
                  key={cs}
                  className="seg-pill"
                  data-active={s.defaultCite === cs}
                  onClick={() => s.setDefaultCite(cs)}
                >
                  {cs}
                </button>
              ))}
            </div>
          </div>

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
