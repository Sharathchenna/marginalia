import { useMemo, useState } from "react";
import type { Store } from "../store";
import { articleHost, faviconUrl, isArticle, itemSource } from "../lib/items";
import { relativeTime } from "../lib/time";
import { RssIcon } from "../icons";

// A site favicon with a letter-badge fallback (feed rows + post river).
function FeedIcon({ host, size = 16 }: { host: string; size?: number }) {
  const url = faviconUrl(host);
  if (!url)
    return (
      <span className="row-favicon row-favicon-fallback" style={{ width: size, height: size, lineHeight: `${size}px` }}>
        {(host[0] || "·").toUpperCase()}
      </span>
    );
  return (
    <img
      className="row-favicon"
      style={{ width: size, height: size }}
      src={url}
      alt=""
      loading="lazy"
      onError={(e) => (e.currentTarget.style.visibility = "hidden")}
    />
  );
}

export function Feeds({ store: s }: { store: Store }) {
  // Newest unread posts across all subscribed feeds.
  const river = useMemo(
    () =>
      s.papers
        .filter((p) => isArticle(p) && itemSource(p) === "feed" && !p.read && !p.archived)
        .sort((a, b) => (b.publishedTs ?? b.addedTs) - (a.publishedTs ?? a.addedTs))
        .slice(0, 24),
    [s.papers],
  );

  // Real in-app input (NOT window.prompt — that returns null in the Tauri webview).
  const [addUrl, setAddUrl] = useState("");
  const doSubscribe = () => {
    const u = addUrl.trim();
    if (!u) return;
    void s.subscribeFeed(u);
    setAddUrl("");
  };

  return (
    <main className="page-scroll">
      <div className="page-inner" style={{ maxWidth: 880 }}>
        <div className="list-header" style={{ paddingLeft: 0, paddingRight: 0 }}>
          <h1 className="page-title" style={{ margin: 0 }}>Blog Feeds</h1>
          <span className="count-pill">{s.counts.feedsUnread} unread</span>
          <div className="spacer" />
          <button className="mini-btn" onClick={() => void s.refreshAllFeeds()} title="Fetch new posts from every feed">
            ↻ Refresh all
          </button>
          <button className="mini-btn" onClick={s.markAllFeedsRead} disabled={s.counts.feedsUnread === 0}>
            ✓ Mark all read
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            doSubscribe();
          }}
          style={{ display: "flex", gap: 9, margin: "4px 0 18px" }}
        >
          <input
            className="id-input"
            style={{ flex: 1 }}
            placeholder="https://example.com  or  https://example.com/feed.xml"
            value={addUrl}
            onChange={(e) => setAddUrl(e.target.value)}
            autoFocus
          />
          <button className="btn-primary" type="submit" disabled={!addUrl.trim()}>
            Subscribe
          </button>
        </form>

        {s.feeds.length === 0 ? (
          <div className="empty-state">
            <RssIcon size={26} style={{ color: "var(--text-3)" }} />
            <p className="big" style={{ marginTop: 10 }}>No blog feeds yet</p>
            <p className="small">
              Subscribe to any blog by its site or RSS/Atom URL — Marginalia checks for new
              posts and files them here as readable articles.
            </p>
            <p className="small" style={{ marginTop: 6, color: "var(--text-3)" }}>
              Paste a URL in the box above to get started.
            </p>
          </div>
        ) : (
          <>
            <section className="dash-section">
              <h2 className="dash-h2">Subscriptions</h2>
              <div className="feed-grid">
                {s.feeds.map((f) => {
                  const host = (() => {
                    try {
                      return new URL(f.siteUrl || f.url).hostname.replace(/^www\./, "");
                    } catch {
                      return f.title;
                    }
                  })();
                  const unread = s.feedUnread[f.id] ?? 0;
                  return (
                    <div key={f.id} className="feed-card" data-error={!!f.lastError}>
                      <button className="feed-card-main" onClick={() => s.pickFilter("feed:" + f.id)} title="Open posts">
                        <FeedIcon host={host} size={18} />
                        <span className="feed-card-title">{f.title}</span>
                        {unread > 0 && <span className="nav-count">{unread}</span>}
                      </button>
                      <div className="feed-card-meta">
                        {f.lastError ? (
                          <span style={{ color: "var(--danger)" }}>⚠ {f.lastError}</span>
                        ) : (
                          <span>{f.lastFetched ? `Updated ${relativeTime(f.lastFetched)}` : "Not fetched yet"}</span>
                        )}
                      </div>
                      <div className="feed-card-actions">
                        <button className="mini-btn muted" title="Refresh" onClick={() => void s.refreshFeed(f.id)}>↻</button>
                        <button
                          className="mini-btn muted"
                          title="Rename"
                          onClick={() => {
                            void s
                              .requestPrompt({ title: "Feed name", value: f.title, confirmLabel: "Rename" })
                              .then((n) => {
                                if (n && n.trim()) s.renameFeed(f.id, n);
                              });
                          }}
                        >
                          ✎
                        </button>
                        <button
                          className="mini-btn muted"
                          title="Folder"
                          onClick={() => {
                            void s
                              .requestPrompt({ title: "Folder", value: f.folder || "", placeholder: "Folder (blank to clear)", confirmLabel: "Save" })
                              .then((n) => {
                                if (n !== null) s.setFeedFolder(f.id, n);
                              });
                          }}
                        >
                          ☰
                        </button>
                        <button
                          className="mini-btn muted"
                          title="Unsubscribe"
                          onClick={() => {
                            void s
                              .requestConfirm({
                                title: `Unsubscribe from “${f.title}”?`,
                                body: "Its saved posts are kept in your library.",
                                confirmLabel: "Unsubscribe",
                                danger: true,
                              })
                              .then((ok) => {
                                if (ok) s.removeFeed(f.id, false);
                              });
                          }}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="dash-section">
              <h2 className="dash-h2">Unread posts</h2>
              {river.length === 0 ? (
                <p className="desc" style={{ marginTop: 0 }}>You're all caught up. ✨</p>
              ) : (
                <div className="dash-list">
                  {river.map((p) => (
                    <button key={p.id} className="dash-item feed-post" onClick={() => s.openReader(p.id)}>
                      <span className="dash-item-title">
                        <FeedIcon host={articleHost(p)} size={13} /> {p.title}
                      </span>
                      <span className="dash-item-meta">
                        {p.venue} · {relativeTime(p.publishedTs ?? p.addedTs) || "recent"}
                        {p.readingTime ? ` · ${p.readingTime} min` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
