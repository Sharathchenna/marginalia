import { useEffect, useRef, useState } from "react";
import { exportLibrary } from "../lib/citation";
import { CITE_STYLE_OPTIONS } from "../lib/csl";
import { invoke, isTauri } from "../lib/tauri";
import { TtsController } from "../lib/tts";
import type { Store } from "../store";
import type { Density } from "../types";
import { FolderIcon } from "../icons";

const EMBED_MODELS = ["voyage-3.5-lite", "voyage-3.5"];

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
  const [phrase, setPhrase] = useState(s.syncPassphrase);
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
      <div style={{ marginTop: 12 }}>
        <h3 style={{ marginBottom: 2 }}>End-to-end encryption</h3>
        <p className="desc">
          Set a passphrase to encrypt your library on this device <em>before</em> it's uploaded —
          the server only ever sees ciphertext. Use the same passphrase on every device. If you
          lose it, the synced copy can't be recovered.
        </p>
        <input
          className="id-input"
          type="password"
          placeholder="Sync passphrase (leave blank to sync unencrypted)"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          onBlur={() => s.setSyncPassphrase(phrase)}
        />
      </div>
      <div style={{ display: "flex", gap: 9, marginTop: 10, alignItems: "center" }}>
        <button className="mini-btn" disabled={s.syncing || !url.trim()} onClick={() => { save(); s.setSyncPassphrase(phrase); void s.syncToWebdav(); }}>
          {s.syncing ? <span className="spinner" /> : "↑"} Push to server
        </button>
        <button className="mini-btn" disabled={s.syncing || !url.trim()} onClick={() => { save(); s.setSyncPassphrase(phrase); void s.syncFromWebdav(); }}>
          {s.syncing ? <span className="spinner" /> : "↓"} Pull from server
        </button>
        {phrase.trim() && <span className="desc" style={{ margin: 0, color: "var(--green)" }}>🔒 encrypted</span>}
      </div>
      <div style={{ marginTop: 12 }}>
        <h3 style={{ marginBottom: 2 }}>Auto-sync on this device</h3>
        <p className="desc">
          Pull on launch and push when the app is backgrounded. Best on a companion device
          (e.g. your phone). Uses last-writer-wins — edit on one device at a time to avoid
          overwrites.
        </p>
        <div className="seg-group">
          <button className="seg-pill" data-active={s.syncAuto} onClick={() => s.setSyncAuto(true)}>On</button>
          <button className="seg-pill" data-active={!s.syncAuto} onClick={() => s.setSyncAuto(false)}>Off</button>
        </div>
      </div>
    </div>
  );
}

// Blog-feed subscriptions (RSS/Atom): add by URL, list, OPML import/export.
function FeedsManager({ store: s }: { store: Store }) {
  const [url, setUrl] = useState("");
  const opmlRef = useRef<HTMLInputElement>(null);
  const subscribe = () => {
    const u = url.trim();
    if (!u) return;
    void s.subscribeFeed(u);
    setUrl("");
  };
  return (
    <div>
      <h3>Blog feeds (RSS)</h3>
      <p className="desc">
        Subscribe to blogs by their site or feed URL — Marginalia checks for new posts every
        15&nbsp;minutes and files them as readable articles.
        {!isTauri() && " Feed fetching runs in the desktop app."}
      </p>
      <div style={{ display: "flex", gap: 9 }}>
        <input
          className="id-input"
          style={{ flex: 1 }}
          placeholder="https://example.com  or  https://example.com/feed.xml"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") subscribe();
          }}
        />
        <button className="mini-btn" onClick={subscribe}>Subscribe</button>
      </div>
      <div className="watch-list" style={{ marginTop: 9 }}>
        {s.feeds.map((f) => (
          <div key={f.id} className="watch-item">
            <span className="dot" style={f.lastError ? { background: "var(--danger)" } : undefined} />
            <span className="path" title={f.url}>
              {f.title}
              {f.folder ? `  ·  ${f.folder}` : ""}
              {(s.feedUnread[f.id] ?? 0) > 0 ? `  ·  ${s.feedUnread[f.id]} unread` : ""}
            </span>
            <span className="more" title="Unsubscribe" onClick={() => s.removeFeed(f.id)}>×</span>
          </div>
        ))}
        {s.feeds.length === 0 && (
          <span className="desc" style={{ margin: 0 }}>No feeds yet.</span>
        )}
      </div>
      <div style={{ display: "flex", gap: 9, marginTop: 10, flexWrap: "wrap" }}>
        <button className="mini-btn" disabled={s.feeds.length === 0} onClick={() => void s.refreshAllFeeds()}>
          ↻ Refresh all
        </button>
        <button className="mini-btn" disabled={s.feeds.length === 0} onClick={s.exportFeedsOPML}>
          Export OPML
        </button>
        <button className="mini-btn" onClick={() => opmlRef.current?.click()}>Import OPML…</button>
        <input
          ref={opmlRef}
          type="file"
          accept=".opml,.xml,application/xml,text/xml"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void f.text().then((t) => s.importFeedsOPML(t));
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

// Self-hosted AI backend — required for AI on iOS/web (no local Node sidecar).
function AiBackend({ store: s }: { store: Store }) {
  const [url, setUrl] = useState(s.apiUrl);
  const [token, setToken] = useState(s.apiToken);
  const save = () => s.setAiBackend(url, token);
  return (
    <div>
      <h3>AI backend (optional)</h3>
      <p className="desc">
        Point at a self-hosted Marginalia AI server (see <span className="mono">server/</span>) to
        enable chat / summarize / auto-tag on this device. Required on iOS and the web build, where
        there's no local AI process. Your API key lives on the server, never on the device.
      </p>
      <input
        className="id-input"
        placeholder="https://ai.example.com"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onBlur={save}
      />
      <input
        className="id-input"
        style={{ marginTop: 9 }}
        type="password"
        placeholder="Bearer token (optional)"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        onBlur={save}
      />
    </div>
  );
}

export function Settings({ store: s }: { store: Store }) {
  const restoreRef = useRef<HTMLInputElement>(null);
  const pocketRef = useRef<HTMLInputElement>(null);

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
                  void s
                    .requestPrompt({ title: "Folder to watch", value: "~/Downloads", confirmLabel: "Add" })
                    .then((next) => {
                      if (next && next.trim()) s.addWatchFolder(next);
                    });
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

          <FeedsManager store={s} />

          <AiBackend store={s} />

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
            <div style={{ marginTop: 14 }}>
              <h3 style={{ marginBottom: 2 }}>Import from Pocket</h3>
              <p className="desc">
                Pocket shut down in 2025 — import your <span className="mono">ril_export.html</span> to
                bring your saves in as bookmarks.
              </p>
              <button className="mini-btn" onClick={() => pocketRef.current?.click()}>
                Import Pocket export…
              </button>
              <input
                ref={pocketRef}
                type="file"
                accept=".html,text/html"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void f.text().then((t) => s.importPocket(t));
                  e.target.value = "";
                }}
              />
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
