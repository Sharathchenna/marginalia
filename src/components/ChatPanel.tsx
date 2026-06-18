import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Store } from "../store";
import { askLibrary, chatAboutPaper, isAgentAvailable } from "../lib/agent";

// A chat turn plus the (optional) streamed reasoning for assistant turns.
type Turn = { role: "user" | "assistant"; text: string; thinking?: string };

// Friendly label for a tool the agent invokes mid-answer.
function toolLabel(name?: string): string {
  if (name === "Read") return "Reading the PDF…";
  if (!name || name === "tool") return "Using a tool…";
  return `${name}…`;
}

// Chat with Claude — about the selected/open paper, or across the whole library
// in view. Conversation state is local to the panel. Renders either as a floating
// drawer (default) or embedded in the reader's right sidebar (`embedded`).
export function ChatPanel({
  store: s,
  embedded,
  width,
}: {
  store: Store;
  embedded?: boolean;
  width?: number;
}) {
  const library = s.chatScope === "library";
  const paper = library ? null : s.screen === "reader" ? s.readerPaper : s.current;
  const [messages, setMessages] = useState<Turn[]>([]);
  const [input, setInput] = useState(s.chatSeed || "");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(""); // live activity (tool / thinking)
  const [error, setError] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const patchLast = (fn: (t: Turn) => Turn) =>
    setMessages((m) => {
      const next = [...m];
      next[next.length - 1] = fn(next[next.length - 1]);
      return next;
    });

  const ready = library ? s.filtered.length > 0 : !!paper;

  const scrollDown = () =>
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });

  const send = async () => {
    const question = input.trim();
    if (!question || busy || !ready) return;
    setError("");
    setInput("");
    const history = messages.map((m) => ({ role: m.role, text: m.text }));
    setMessages((m) => [...m, { role: "user", text: question }, { role: "assistant", text: "" }]);
    setBusy(true);
    setStatus("Thinking…");
    scrollDown();

    const handlers = {
      onDelta: (text: string) => {
        setStatus(""); // answer is flowing now
        patchLast((t) => ({ ...t, text: t.text + text }));
        scrollDown();
      },
      onThinkingStart: () => setStatus("Thinking…"),
      onThinking: (text: string) => {
        setStatus("Thinking…");
        patchLast((t) => ({ ...t, thinking: (t.thinking ?? "") + text }));
        scrollDown();
      },
      onTool: (info: { name?: string; phase: "start" | "done" }) => {
        setStatus(info.phase === "start" ? toolLabel(info.name) : "Thinking…");
        scrollDown();
      },
      onDone: (info?: { model: string | null }) => {
        if (info?.model) setModel(info.model);
        setBusy(false);
        setStatus("");
        scrollDown();
      },
      onError: (msg: string) => {
        setBusy(false);
        setStatus("");
        setError(msg);
        setMessages((m) => (m[m.length - 1]?.text === "" && !m[m.length - 1]?.thinking ? m.slice(0, -1) : m));
      },
    };

    if (library) {
      // Hybrid retrieval (lexical + semantic when indexed): pick the most relevant
      // papers across the WHOLE library for this question, instead of stuffing the
      // first 60 of the current filter.
      const pool = await s.hybridRetrieve(question, 16);
      const ctx = pool.map((p) => ({
        title: p.title,
        authors: p.authors,
        year: p.year,
        venue: p.venue,
        abstract: p.abstract,
        summary: p.summary,
      }));
      await askLibrary(ctx, question, history, handlers);
    } else if (paper) {
      const pdfPath = paper.file
        ? `${s.libraryLocation.replace(/\/+$/, "")}/${paper.file}`
        : undefined;
      await chatAboutPaper(paper, question, history, handlers, pdfPath, s.chatSelection || undefined);
    }
  };

  return (
    <div
      className={embedded ? "chat-sidebar" : "chat-drawer"}
      style={embedded && width ? { width } : undefined}
    >
      <div className="chat-head">
        <div style={{ minWidth: 0 }}>
          <div className="chat-title">{library ? "Ask your library" : "Ask about this paper"}</div>
          <div className="chat-sub">
            {library ? `${s.filtered.length} papers in “${s.filterTitle}”` : paper?.title ?? "No paper selected"}
          </div>
          {model && (
            <div className="chat-model" title="Model used for the last response">
              Model: {model}
            </div>
          )}
        </div>
        <button className="modal-x" onClick={s.closeChat}>×</button>
      </div>

      {!library && s.chatSelection && (
        <div className="chat-context-chip">
          <span className="chip-label">Focused on</span>
          <span className="chip-text">"{s.chatSelection.slice(0, 140)}{s.chatSelection.length > 140 ? "…" : ""}"</span>
          <span className="chip-x" title="Clear focus" onClick={s.clearChatSelection}>×</span>
        </div>
      )}

      <div className="chat-scroll" ref={scrollRef}>
        {!isAgentAvailable() && (
          <div className="chat-notice">
            AI chat runs in the native desktop app (it spawns the Claude Agent SDK
            sidecar). Open Marginalia.app rather than the web preview.
          </div>
        )}
        {messages.length === 0 && isAgentAvailable() && (
          <div className="chat-notice">
            {library ? (
              <>Ask across your {s.filtered.length} papers — “which papers cover X?”, comparisons, gaps, a mini lit-review.</>
            ) : (
              <>Ask anything about <b>{paper?.title}</b> — method, contributions, limitations, or how it relates to your other papers.</>
            )}
          </div>
        )}
        {messages.map((m, i) => {
          const isLast = i === messages.length - 1;
          if (m.role === "assistant") {
            return (
              <div key={i} className="chat-bubble assistant chat-md">
                {m.thinking && (
                  <details className="chat-thinking" open={busy && isLast && !m.text}>
                    <summary>💭 Thinking</summary>
                    <div className="chat-thinking-body">{m.thinking}</div>
                  </details>
                )}
                {m.text && <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>}
                {!m.text && busy && isLast && (
                  <div className="chat-status">
                    <span className="spinner" />
                    <span>{status || "Thinking…"}</span>
                  </div>
                )}
              </div>
            );
          }
          return (
            <div key={i} className="chat-bubble user">
              {m.text}
            </div>
          );
        })}
        {error && <div className="chat-error">{error}</div>}
      </div>

      <div className="chat-input-row">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={ready ? "Ask a question… (Enter to send)" : "Nothing to ask about yet"}
          rows={2}
          disabled={!ready || busy}
        />
        <button className="btn-go" onClick={send} disabled={!ready || busy || !input.trim()}>
          {busy ? <span className="spinner" /> : "Send"}
        </button>
      </div>
    </div>
  );
}
