import { useRef, useState } from "react";
import { CITE_STYLE_FULL } from "../data";
import { citation, citationText } from "../lib/citation";
import type { Store } from "../store";
import type { CiteStyle } from "../types";
import { CopyIcon, UploadIcon } from "../icons";

const CITE_STYLES: CiteStyle[] = ["APA", "MLA", "Chicago", "BibTeX"];

export function ImportModal({ store: s }: { store: Store }) {
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const onFiles = (files: FileList | null) => {
    if (!files?.length) return;
    Promise.all(Array.from(files).map((f) => f.text())).then((texts) =>
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
  const html = citation(s.current, s.citeStyle);
  return (
    <div className="scrim center" onClick={s.closeOverlays}>
      <div className="modal" style={{ width: 540 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Cite this paper</h2>
          <button className="modal-x" onClick={s.closeOverlays}>×</button>
        </div>
        <div className="modal-body">
          <div className="seg-group" data-on-panel="true">
            {CITE_STYLES.map((cs) => (
              <button
                key={cs}
                className="seg-pill"
                data-active={s.citeStyle === cs}
                onClick={() => s.setCiteStyle(cs)}
              >
                {cs}
              </button>
            ))}
          </div>
          <div className="cite-preview" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
        <div className="cite-foot">
          <span className="style-full">{CITE_STYLE_FULL[s.citeStyle]}</span>
          <button
            className="btn-go"
            onClick={() => s.copyCite(citationText(s.current, s.citeStyle))}
          >
            <CopyIcon size={13} />
            Copy
          </button>
        </div>
      </div>
    </div>
  );
}
