import { useEffect, useRef, useState } from "react";
import { exportLibrary } from "../lib/citation";
import { invoke, isTauri } from "../lib/tauri";
import { TtsController } from "../lib/tts";
import type { Store } from "../store";
import type { CiteStyle, Density } from "../types";
import { FolderIcon } from "../icons";

const EMBED_MODELS = ["voyage-3.5-lite", "voyage-3.5"];

const CITE_STYLES: CiteStyle[] = ["APA", "MLA", "Chicago", "BibTeX"];
const DENSITIES: Density[] = ["compact", "comfortable"];

const TTS_PROVIDERS: { id: string; label: string }[] = [
  { id: "edge", label: "Edge neural" },
  { id: "system", label: "System voice" },
  { id: "off", label: "Off" },
];

// Shown until the live voice list loads (or when running in the browser preview).
const FALLBACK_VOICES = [
  { name: "en-US-AriaNeural", label: "Aria", locale: "en-US", gender: "Female" },
  { name: "en-US-JennyNeural", label: "Jenny", locale: "en-US", gender: "Female" },
  { name: "en-US-GuyNeural", label: "Guy", locale: "en-US", gender: "Male" },
  { name: "en-US-AndrewNeural", label: "Andrew", locale: "en-US", gender: "Male" },
  { name: "en-US-EmmaNeural", label: "Emma", locale: "en-US", gender: "Female" },
  { name: "en-GB-SoniaNeural", label: "Sonia", locale: "en-GB", gender: "Female" },
  { name: "en-GB-RyanNeural", label: "Ryan", locale: "en-GB", gender: "Male" },
];

type TtsVoice = { name: string; label: string; locale: string; gender: string };

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

  // Live Edge voice list (English only, deduped) with a static fallback.
  const [voices, setVoices] = useState<TtsVoice[]>(FALLBACK_VOICES);
  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    void invoke<{ voices: TtsVoice[] }>("tts_voices")
      .then((r) => {
        if (!alive || !r?.voices?.length) return;
        const en = r.voices.filter((v) => v.locale.startsWith("en-"));
        setVoices(en.length ? en : r.voices);
      })
      .catch(() => {/* keep fallback */});
    return () => {
      alive = false;
    };
  }, []);

  // One-off controller for the "Preview" button.
  const previewRef = useRef<TtsController | null>(null);
  const preview = () => {
    if (!previewRef.current) previewRef.current = new TtsController();
    previewRef.current.start(
      "This is how your papers will sound when read aloud.",
      { provider: s.ttsProvider === "off" ? "edge" : s.ttsProvider, voice: s.ttsVoice, rate: s.ttsRate },
    );
  };

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
            <h3>Read aloud</h3>
            <p className="desc">
              Listen to papers in the reader. <strong>Edge neural</strong> uses Microsoft’s free
              online voices (no key, needs internet); <strong>System voice</strong> uses your OS’s
              built-in voice and works offline.
            </p>
            <div className="seg-group">
              {TTS_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  className="seg-pill"
                  data-active={s.ttsProvider === p.id}
                  onClick={() => s.setTtsProvider(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {s.ttsProvider === "edge" && (
              <div style={{ display: "flex", gap: 9, marginTop: 10, alignItems: "center" }}>
                <select
                  className="id-input"
                  style={{ flex: 1 }}
                  value={s.ttsVoice}
                  onChange={(e) => s.setTtsVoice(e.target.value)}
                >
                  {voices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.label} · {v.locale} · {v.gender}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {s.ttsProvider !== "off" && (
              <div style={{ display: "flex", gap: 12, marginTop: 12, alignItems: "center" }}>
                <span className="desc" style={{ margin: 0, minWidth: 42 }}>
                  Speed
                </span>
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.1}
                  value={s.ttsRate}
                  onChange={(e) => s.setTtsRate(Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <span className="desc" style={{ margin: 0, minWidth: 34 }}>
                  {s.ttsRate.toFixed(1)}×
                </span>
                <button className="mini-btn" onClick={preview}>
                  Preview
                </button>
              </div>
            )}
          </div>

          {isTauri() && (
            <div>
              <h3>Sync (self-hosted server)</h3>
              <p className="desc">
                Keep your library in lockstep across desktop and iOS via your self-hosted server.
                Paste the same server URL + token you use in the iOS app — papers sync per-record
                automatically (and on launch).
              </p>
              <input
                className="id-input"
                placeholder="Server URL (https://…)"
                value={s.apiUrl}
                onChange={(e) => s.setApiUrl(e.target.value.trim())}
              />
              <input
                className="id-input"
                type="password"
                placeholder="Token"
                value={s.apiToken}
                onChange={(e) => s.setApiToken(e.target.value.trim())}
                style={{ marginTop: 9 }}
              />
              <div style={{ display: "flex", gap: 9, marginTop: 10, alignItems: "center" }}>
                <button className="mini-btn" disabled={s.syncing || !s.apiToken} onClick={() => void s.syncNow()}>
                  {s.syncing ? <span className="spinner" /> : "Sync now"}
                </button>
                {s.syncStatus && (
                  <span className="desc" style={{ margin: 0 }}>
                    {s.syncStatus}
                  </span>
                )}
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
