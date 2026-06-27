import type { Store } from "../store";
import { AGENT_MODELS, isAgentAvailable } from "../lib/agent";
import { faviconUrl } from "../lib/items";
import {
  AllPapersIcon,
  BookmarkIcon,
  ClockIcon,
  DotIcon,
  InboxIcon,
  NotebookIcon,
  RssIcon,
  SearchIcon,
  SettingsIcon,
  StarNavIcon,
  WatchFolderIcon,
} from "../icons";

export function Sidebar({ store: s }: { store: Store }) {
  // Only the most-used tags — a full list overwhelms the sidebar. The rest are
  // reachable via ⌘K search and the detail panel.
  const tagFreq = new Map<string, number>();
  for (const p of s.papers) for (const t of p.tags) tagFreq.set(t, (tagFreq.get(t) ?? 0) + 1);
  const topTags = [...tagFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);
  const isF = (f: string) => s.filter === f && s.screen === "library";

  return (
    <aside className="sidebar">
      <div className="sidebar-scroll">
        <div className="nav-group">
          <button className="nav-item" data-active={s.screen === "dashboard"} onClick={() => s.goScreen("dashboard")}>
            <WatchFolderIcon size={15} />
            <span className="grow">Home</span>
          </button>
          <button className="nav-item" data-active={isF("queue")} onClick={() => s.pickFilter("queue")}>
            <InboxIcon size={15} />
            <span className="grow">Inbox</span>
            <span className="nav-count">{s.counts.queue}</span>
          </button>
          <button className="nav-item" data-active={isF("all")} onClick={() => s.pickFilter("all")}>
            <AllPapersIcon size={15} />
            <span className="grow">All Papers</span>
            <span className="nav-count">{s.counts.all}</span>
          </button>
          <button className="nav-item" data-active={isF("fav")} onClick={() => s.pickFilter("fav")}>
            <StarNavIcon size={15} />
            <span className="grow">Favorites</span>
            <span className="nav-count">{s.counts.fav}</span>
          </button>
          <button className="nav-item" data-active={isF("unread")} onClick={() => s.pickFilter("unread")}>
            <DotIcon size={15} />
            <span className="grow">Unread</span>
            <span className="nav-count">{s.counts.unread}</span>
          </button>
        </div>

        <div className="section-head">
          <span className="label">Read</span>
          <span
            className="plus"
            title="Subscribe to a blog feed"
            onClick={() => s.goScreen("feeds")}
          >
            +
          </span>
        </div>
        <div className="nav-group">
          <button className="nav-item" data-active={isF("bookmarks")} onClick={() => s.pickFilter("bookmarks")}>
            <BookmarkIcon size={15} />
            <span className="grow">Bookmarks</span>
            <span className="nav-count">{s.counts.bookmarks}</span>
          </button>
          <button
            className="nav-item"
            data-active={s.screen === "feeds" || isF("feeds")}
            onClick={() => s.goScreen("feeds")}
          >
            <RssIcon size={15} />
            <span className="grow">Blog Feeds</span>
            {s.counts.feedsUnread > 0 && <span className="nav-count">{s.counts.feedsUnread}</span>}
          </button>
          {s.counts.archived > 0 && (
            <button className="nav-item" data-active={isF("archived")} onClick={() => s.pickFilter("archived")}>
              <ClockIcon size={15} />
              <span className="grow">Archive</span>
              <span className="nav-count">{s.counts.archived}</span>
            </button>
          )}
          {s.feeds.map((f) => {
            const unread = s.feedUnread[f.id] ?? 0;
            const icon = f.favicon || faviconUrl(new URL(f.siteUrl || f.url, f.url).hostname.replace(/^www\./, ""));
            return (
              <button
                key={f.id}
                className="nav-item nav-feed"
                data-active={isF("feed:" + f.id)}
                title={f.lastError ? `Last sync failed: ${f.lastError}` : f.title}
                onClick={() => s.pickFilter("feed:" + f.id)}
              >
                {icon ? (
                  <img className="feed-favicon" src={icon} alt="" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
                ) : (
                  <span className="feed-favicon feed-favicon-fallback">{f.title.charAt(0).toUpperCase()}</span>
                )}
                <span className="grow">{f.title}</span>
                {f.lastError && <span className="feed-err" title={f.lastError}>!</span>}
                {unread > 0 && <span className="nav-count">{unread}</span>}
              </button>
            );
          })}
        </div>

        <div className="section-head">
          <span className="label">Collections</span>
          <span
            className="plus"
            title="New collection"
            onClick={() => {
              void s
                .requestPrompt({ title: "New collection", placeholder: "Collection name", confirmLabel: "Create" })
                .then((n) => {
                  if (n && n.trim()) s.createCollection(n);
                });
            }}
          >
            +
          </span>
        </div>
        <div className="nav-group">
          {s.collections.map((c) => (
            <div key={c.id} className="coll-row">
              <button
                className="nav-item"
                data-active={isF(c.id)}
                onClick={() => s.pickFilter(c.id)}
              >
                <span className="coll-dot" style={{ background: c.color, marginLeft: c.indent }} />
                <span className="grow">{c.name}</span>
                <span className="nav-count">{c.ids.length}</span>
              </button>
              <div className="coll-actions">
                <span
                  title="Rename"
                  onClick={() => {
                    void s
                      .requestPrompt({ title: "Rename collection", value: c.name, confirmLabel: "Rename" })
                      .then((n) => {
                        if (n && n.trim()) s.renameCollection(c.id, n);
                      });
                  }}
                >
                  ✎
                </span>
                <span
                  title="Delete"
                  onClick={() => {
                    void s
                      .requestConfirm({
                        title: `Delete “${c.name}”?`,
                        body: "The papers are kept — only the collection is removed.",
                        confirmLabel: "Delete",
                        danger: true,
                      })
                      .then((ok) => {
                        if (ok) s.deleteCollection(c.id);
                      });
                  }}
                >
                  ×
                </span>
              </div>
            </div>
          ))}
        </div>

        {topTags.length > 0 && (
          <>
            <div style={{ padding: "18px 8px 6px" }}>
              <span className="section-label">Top tags</span>
            </div>
            <div className="tag-wrap">
              {topTags.map((t) => (
                <button
                  key={t}
                  className="tag-chip"
                  data-active={isF("tag:" + t)}
                  onClick={() => s.pickFilter("tag:" + t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="sidebar-footer">
        {isAgentAvailable() && (
          <label className="model-select" title="Model used for all AI actions">
            <span className="model-select-label">AI model</span>
            <select value={s.model} onChange={(e) => s.setModel(e.target.value)}>
              {AGENT_MODELS.map((m) => (
                <option key={m.id || "default"} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="nav-item" data-active={s.screen === "notebook"} onClick={() => s.goScreen("notebook")}>
          <NotebookIcon size={15} />
          <span className="grow">Notebook</span>
        </button>
        <button className="nav-item" data-active={s.screen === "flashcards"} onClick={() => s.goScreen("flashcards")}>
          <DotIcon size={15} />
          <span className="grow">Flashcards</span>
        </button>
        <button className="nav-item" data-active={s.screen === "review"} onClick={() => s.goScreen("review")}>
          <ClockIcon size={15} />
          <span className="grow">Daily Review</span>
        </button>
        <button className="nav-item" data-active={s.screen === "graph"} onClick={() => s.goScreen("graph")}>
          <AllPapersIcon size={15} />
          <span className="grow">Connections</span>
        </button>
        <button className="nav-item" data-active={s.screen === "discover"} onClick={() => s.openDiscover()}>
          <SearchIcon size={15} />
          <span className="grow">Discover</span>
        </button>
        <button className="nav-item" data-active={s.screen === "settings"} onClick={() => s.goScreen("settings")}>
          <SettingsIcon size={15} />
          <span className="grow">Settings</span>
        </button>
      </div>
    </aside>
  );
}
