import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Store } from "../store";
import { askLibrary, chatAboutPaper, isAgentAvailable, type ChatTurn } from "../lib/agent";

// Right-side drawer to chat with Claude — about the selected/open paper, or
// across the whole library in view. Conversation state is local to the drawer.
export function ChatPanel({ store: s }: { store: Store }) {
  const library = s.chatScope === "library";
  const paper = library ? null : s.screen === "reader" ? s.readerPaper : s.current;
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState(s.chatSeed || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

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
    const history = messages;
    setMessages((m) => [...m, { role: "user", text: question }, { role: "assistant", text: "" }]);
    setBusy(true);
    scrollDown();

    const handlers = {
      onDelta: (text: string) => {
        setMessages((m) => {
          const next = [...m];
          next[next.length - 1] = { role: "assistant" as const, text: next[next.length - 1].text + text };
          return next;
        });
        scrollDown();
      },
      onDone: () => {
        setBusy(false);
        scrollDown();
      },
      onError: (msg: string) => {
        setBusy(false);
        setError(msg);
        setMessages((m) => (m[m.length - 1]?.text === "" ? m.slice(0, -1) : m));
      },
    };

    if (library) {
      const ctx = s.filtered.slice(0, 60).map((p) => ({
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
    <div className="chat-drawer">
      <div className="chat-head">
        <div style={{ minWidth: 0 }}>
          <div className="chat-title">{library ? "Ask your library" : "Ask about this paper"}</div>
          <div className="chat-sub">
            {library ? `${s.filtered.length} papers in “${s.filterTitle}”` : paper?.title ?? "No paper selected"}
          </div>
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
                {m.text ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                ) : busy && isLast ? (
                  <span className="chat-cursor">▍</span>
                ) : null}
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
