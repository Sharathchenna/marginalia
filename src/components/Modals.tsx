import { useEffect, useMemo, useRef, useState } from "react";
import { CITE_STYLE_FULL } from "../data";
import { CITE_STYLE_OPTIONS, formatHtml, formatText } from "../lib/csl";
import type { Store } from "../store";
import { CopyIcon, UploadIcon } from "../icons";

// Keyboard shortcuts cheat-sheet (opened with "?" or from the command palette).
const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: "⌘K", label: "Command palette — run any action" },
  { keys: "⌘N", label: "Add by DOI / arXiv / URL" },
  { keys: "?", label: "This shortcuts sheet" },
  { keys: "↑ ↓ / j k", label: "Move through the list" },
  { keys: "↵ / o", label: "Open the selected item in the reader" },
  { keys: "Esc", label: "Close overlays" },
  { keys: "← →", label: "Reader: previous / next page" },
  { keys: "+ − 0", label: "Reader: zoom in / out / reset" },
  { keys: "⌘F", label: "Reader: find in document" },
];

export function ShortcutsModal({ store: s }: { store: Store }) {
  return (
    <div className="scrim center" onClick={s.closeShortcuts}>
      <div className="modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Keyboard shortcuts</h2>
          <button className="modal-x" onClick={s.closeShortcuts}>×</button>
        </div>
        <div className="modal-body">
          <div className="shortcuts-grid">
            {SHORTCUTS.map((sc) => (
              <div className="shortcut-row" key={sc.keys}>
                <kbd className="shortcut-keys">{sc.keys}</kbd>
                <span className="shortcut-label">{sc.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// In-app replacement for window.prompt / window.confirm (both no-ops in the Tauri
// webview). Driven by store.dialog; resolves the pending Promise via closeDialog.
export function DialogModal({ store: s }: { store: Store }) {
  const d = s.dialog;
  const [val, setVal] = useState(d?.kind === "prompt" ? d.value : "");
  useEffect(() => {
    setVal(d?.kind === "prompt" ? d.value : "");
  }, [d]);
  if (!d) return null;
  const cancel = () => s.closeDialog(d.kind === "prompt" ? null : false);
  const accept = () => s.closeDialog(d.kind === "prompt" ? val : true);
  return (
    <div className="scrim center" onMouseDown={cancel}>
      <div className="modal" style={{ width: 420 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{d.title}</h2>
          <button className="modal-x" onClick={cancel}>×</button>
        </div>
        <div className="modal-body">
          {d.kind === "prompt" ? (
            <input
              className="id-input"
              autoFocus
              value={val}
              placeholder={d.placeholder}
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  accept();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancel();
                }
              }}
            />
          ) : (
            d.body && <p style={{ fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.55 }}>{d.body}</p>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn-cancel" onClick={cancel}>Cancel</button>
          <button
            className="btn-primary"
            style={d.kind === "confirm" && d.danger ? { background: "var(--danger)" } : undefined}
            onClick={accept}
          >
            {d.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const STYLE_LABEL: Record<string, string> = Object.fromEntries(
  CITE_STYLE_OPTIONS.map((o) => [String(o.id), o.label]),
);

const REASON_LABEL: Record<string, string> = {
  doi: "Same DOI",
  arxiv: "Same arXiv ID",
  title: "Same title + year",
};

export function ImportModal({ store: s }: { store: Store }) {
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const onFiles = (files: FileList | null) => {
    if (!files?.length) return;
    // Only read text bibliography files — never dump a dropped binary (e.g. a
    // PDF) into the textarea.
    const accepted = Array.from(files).filter((f) => /\.(bib|ris|txt)$/i.test(f.name));
    if (!accepted.length) {
      s.showToast("Drop a .bib or .ris file");
      return;
    }
    Promise.all(accepted.map((f) => f.text())).then((texts) =>
      setText((cur) => [cur, ...texts].filter(Boolean).join("\n\n")),
    );
  };

  return (
    <div className="scrim center" onClick={s.closeOverlays}>
      <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Import papers</h2>
          <button className="modal-x" onClick={s.closeOverlays}>×</button>
        </div>
        <div className="modal-body">
          <div
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              onFiles(e.dataTransfer.files);
            }}
            onClick={() => fileRef.current?.click()}
            style={{ cursor: "pointer" }}
          >
            <div className="dropzone-icon">
              <UploadIcon size={22} />
            </div>
            <p className="big">Drop a .bib or .ris file here</p>
            <p className="small">
              or <span className="link">browse your files</span>
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".bib,.ris,.txt"
              multiple
              hidden
              onChange={(e) => onFiles(e.target.files)}
            />
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="…or paste BibTeX / RIS entries here"
            style={{
              width: "100%",
              marginTop: 14,
              minHeight: 110,
              padding: 12,
              background: "var(--field)",
              border: "1px solid var(--field-border)",
              borderRadius: 9,
              fontSize: 12.5,
              fontFamily: "'JetBrains Mono', monospace",
              color: "var(--text-1)",
              resize: "vertical",
              outline: "none",
            }}
          />
        </div>
        <div className="modal-foot">
          <button className="btn-cancel" onClick={s.closeOverlays}>Cancel</button>
          <button className="btn-go" onClick={() => s.importBibliography(text)}>
            Import
          </button>
        </div>
      </div>
    </div>
  );
}

export function AddByIdModal({ store: s }: { store: Store }) {
  return (
    <div className="scrim center" onClick={s.closeOverlays}>
      <div className="modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head" style={{ display: "block" }}>
          <h2>Add by identifier</h2>
          <p className="sub">Paste a DOI, arXiv ID, or URL (incl. Hugging Face) and we'll fetch the rest.</p>
        </div>
        <div className="modal-body">
          <input
            className="id-input"
            value={s.idText}
            autoFocus
            onChange={(e) => s.setIdText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !s.idBusy && s.lookupIdentifier()}
            placeholder="10.48550/arXiv.1706.03762"
          />
          {s.idError ? (
            <p style={{ fontSize: 12, color: "#C0395E", marginTop: 9 }}>{s.idError}</p>
          ) : (
            <div className="id-examples">
              <span className="lbl">Examples:</span>
              <span className="ex" onClick={() => s.setIdText("arXiv:1706.03762")}>arXiv:1706.03762</span>
              <span className="ex" onClick={() => s.setIdText("https://arxiv.org/abs/1706.03762")}>arxiv.org/abs/…</span>
              <span className="ex" onClick={() => s.setIdText("10.1038/nature16961")}>10.1038/nature16961</span>
              <span className="ex" onClick={() => s.setIdText("huggingface.co/papers/2310.06825")}>huggingface.co/papers/…</span>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn-cancel" onClick={s.closeOverlays}>Cancel</button>
          <button className="btn-go" onClick={s.lookupIdentifier} disabled={s.idBusy}>
            {s.idBusy && <span className="spinner" />}
            {s.idBusy ? "Looking up…" : "Look up"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CiteModal({ store: s }: { store: Store }) {
  const html = formatHtml(s.current, s.citeStyle);
  return (
    <div className="scrim center" onClick={s.closeOverlays}>
      <div className="modal" style={{ width: 540 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Cite this paper</h2>
          <button className="modal-x" onClick={s.closeOverlays}>×</button>
        </div>
        <div className="modal-body">
          <div className="seg-group" data-on-panel="true" style={{ flexWrap: "wrap" }}>
            {CITE_STYLE_OPTIONS.map((cs) => (
              <button
                key={String(cs.id)}
                className="seg-pill"
                data-active={s.citeStyle === cs.id}
                onClick={() => s.setCiteStyle(cs.id)}
              >
                {cs.label}
              </button>
            ))}
          </div>
          <div className="cite-preview" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
        <div className="cite-foot">
          <span className="style-full">
            {CITE_STYLE_FULL[s.citeStyle] ?? STYLE_LABEL[String(s.citeStyle)] ?? s.citeStyle}
          </span>
          <button
            className="btn-go"
            onClick={() => s.copyCite(formatText(s.current, s.citeStyle))}
          >
            <CopyIcon size={13} />
            Copy
          </button>
        </div>
      </div>
    </div>
  );
}

const STANCE_STYLE: Record<string, { label: string; color: string }> = {
  supports: { label: "Supports", color: "var(--green)" },
  contradicts: { label: "Contradicts", color: "var(--danger)" },
  neutral: { label: "Neutral", color: "var(--text-3)" },
  include: { label: "Include", color: "var(--green)" },
  exclude: { label: "Exclude", color: "var(--danger)" },
  maybe: { label: "Maybe", color: "var(--star)" },
};

export function ClaimModal({ store: s }: { store: Store }) {
  const [text, setText] = useState("");
  const task = s.claimTask;
  const result = s.claimResult;
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const it of result?.items ?? []) c[it.stance] = (c[it.stance] ?? 0) + 1;
    return c;
  }, [result]);
  const titleFor = (id: string) => s.papers.find((p) => p.id === id)?.title ?? id;

  return (
    <div className="scrim center" onClick={s.closeClaim}>
      <div className="modal" style={{ width: 640, maxHeight: "84vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Research assistant</h2>
          <button className="modal-x" onClick={s.closeClaim}>×</button>
        </div>
        <div className="modal-body" style={{ overflow: "auto" }}>
          <div className="seg-group" data-on-panel="true">
            <button className="seg-pill" data-active={task === "verify"} onClick={() => s.setClaimTask("verify")}>
              Verify a claim
            </button>
            <button className="seg-pill" data-active={task === "screen"} onClick={() => s.setClaimTask("screen")}>
              Screen for review
            </button>
          </div>
          <p className="desc" style={{ marginTop: 10 }}>
            {task === "verify"
              ? "State a claim — Claude checks the most relevant papers in your library and reports whether they support or contradict it."
              : "Describe your inclusion criteria — Claude screens the papers in the current view (include / exclude / maybe) for a systematic review."}
          </p>
          <textarea
            className="notes-edit"
            style={{ minHeight: 70 }}
            value={text}
            placeholder={
              task === "verify"
                ? "e.g. Transformers outperform RNNs on long-sequence tasks"
                : "e.g. Include randomized controlled trials on RLHF published after 2020"
            }
            onChange={(e) => setText(e.target.value)}
          />
          <div style={{ display: "flex", gap: 9, marginTop: 10, alignItems: "center" }}>
            <button className="btn-go" disabled={s.claimBusy || !text.trim()} onClick={() => s.runAssess(text)}>
              {s.claimBusy && <span className="spinner" />}
              {s.claimBusy ? "Assessing…" : task === "verify" ? "Verify" : "Screen"}
            </button>
          </div>

          {s.claimError && (
            <p style={{ fontSize: 12, color: "var(--danger)", marginTop: 10 }}>{s.claimError}</p>
          )}

          {result && (
            <div style={{ marginTop: 16 }}>
              <div className="summary-box" style={{ marginBottom: 12 }}>{result.summary}</div>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 12 }}>
                {Object.entries(counts).map(([stance, n]) => {
                  const st = STANCE_STYLE[stance] ?? { label: stance, color: "var(--text-3)" };
                  return (
                    <span
                      key={stance}
                      className="count-pill"
                      style={{ color: st.color, borderColor: st.color }}
                    >
                      {st.label}: {n}
                    </span>
                  );
                })}
              </div>
              <div className="dup-list">
                {result.items.map((it, i) => {
                  const st = STANCE_STYLE[it.stance] ?? { label: it.stance, color: "var(--text-3)" };
                  return (
                    <div key={i} className="dup-item" style={{ borderLeft: `3px solid ${st.color}`, paddingLeft: 9 }}>
                      <span className="dup-title">
                        <span style={{ color: st.color, fontWeight: 700, fontSize: 11, marginRight: 6 }}>
                          {st.label.toUpperCase()}
                        </span>
                        {titleFor(it.id)}
                      </span>
                      {it.evidence && <span className="dup-meta">{it.evidence}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn-cancel" onClick={s.closeClaim}>Close</button>
        </div>
      </div>
    </div>
  );
}

export function DuplicatesModal({ store: s }: { store: Store }) {
  // Snapshot the groups when the modal opens; merging mutates the library and
  // shrinks this list, so we recompute from a state copy after each merge.
  const initial = useMemo(() => s.duplicateGroups(), [s.duplicateGroups]);
  const [groups, setGroups] = useState(initial);

  const mergeOne = (idx: number) => {
    s.mergeDuplicate(groups[idx].papers);
    setGroups((gs) => gs.filter((_, i) => i !== idx));
  };

  return (
    <div className="scrim center" onClick={s.closeDuplicates}>
      <div className="modal" style={{ width: 620, maxHeight: "80vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Duplicate papers</h2>
          <button className="modal-x" onClick={s.closeDuplicates}>×</button>
        </div>
        <div className="modal-body" style={{ overflow: "auto" }}>
          {groups.length === 0 ? (
            <p className="desc" style={{ margin: 0 }}>
              No duplicates found — every paper has a distinct DOI, arXiv ID, and title.
            </p>
          ) : (
            <div className="dup-groups">
              {groups.map((g, i) => (
                <div key={i} className="dup-group">
                  <div className="dup-group-head">
                    <span className="dup-reason">{REASON_LABEL[g.reason] ?? g.reason}</span>
                    <span className="dup-count">{g.papers.length} copies</span>
                    <button className="btn-go" style={{ marginLeft: "auto" }} onClick={() => mergeOne(i)}>
                      Merge
                    </button>
                  </div>
                  <div className="dup-list">
                    {g.papers.map((p) => (
                      <div key={p.id} className="dup-item">
                        <span className="dup-title">{p.title}</span>
                        <span className="dup-meta">
                          {p.authors} · {p.year || "—"} · {p.venue}
                          {p.hl.length ? ` · ${p.hl.length} hl` : ""}
                          {p.file ? " · PDF" : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn-cancel" onClick={s.closeDuplicates}>Close</button>
        </div>
      </div>
    </div>
  );
}
