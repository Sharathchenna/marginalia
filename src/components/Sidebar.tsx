import type { Store } from "../store";
import {
  AllPapersIcon,
  ClockIcon,
  DotIcon,
  NotebookIcon,
  SearchIcon,
  SettingsIcon,
  StarNavIcon,
  WatchFolderIcon,
} from "../icons";

export function Sidebar({ store: s }: { store: Store }) {
  const allTags = [...new Set(s.papers.flatMap((p) => p.tags))];
  const isF = (f: string) => s.filter === f && s.screen === "library";

  return (
    <aside className="sidebar">
      <div className="sidebar-scroll">
        <div className="nav-group">
          <button className="nav-item" data-active={s.screen === "dashboard"} onClick={() => s.goScreen("dashboard")}>
            <WatchFolderIcon size={15} />
            <span className="grow">Home</span>
          </button>
          <button className="nav-item" data-active={isF("all")} onClick={() => s.pickFilter("all")}>
            <AllPapersIcon size={15} />
            <span className="grow">All Papers</span>
            <span className="nav-count">{s.counts.all}</span>
          </button>
          <button className="nav-item" data-active={isF("recent")} onClick={() => s.pickFilter("recent")}>
            <ClockIcon size={15} />
            <span className="grow">Recently Added</span>
            <span className="nav-count">{s.counts.recent}</span>
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
          <button className="nav-item" data-active={isF("queue")} onClick={() => s.pickFilter("queue")}>
            <ClockIcon size={15} />
            <span className="grow">Reading Queue</span>
            <span className="nav-count">{s.counts.queue}</span>
          </button>
        </div>

        <div className="section-head">
          <span className="label">Collections</span>
          <span
            className="plus"
            title="New collection"
            onClick={() => {
              const n = window.prompt("New collection name");
              if (n) s.createCollection(n);
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
                    const n = window.prompt("Rename collection", c.name);
                    if (n) s.renameCollection(c.id, n);
                  }}
                >
                  ✎
                </span>
                <span
                  title="Delete"
                  onClick={() => {
                    if (window.confirm(`Delete collection “${c.name}”? (papers are kept)`))
                      s.deleteCollection(c.id);
                  }}
                >
                  ×
                </span>
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding: "18px 8px 6px" }}>
          <span className="section-label">Tags</span>
        </div>
        <div className="tag-wrap">
          {allTags.map((t) => (
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
      </div>

      <div className="sidebar-footer">
        <button className="nav-item" data-active={s.screen === "notebook"} onClick={() => s.goScreen("notebook")}>
          <NotebookIcon size={15} />
          <span className="grow">Notebook</span>
        </button>
        <button className="nav-item" data-active={s.screen === "flashcards"} onClick={() => s.goScreen("flashcards")}>
          <DotIcon size={15} />
          <span className="grow">Flashcards</span>
        </button>
        <button className="nav-item" data-active={s.screen === "graph"} onClick={() => s.goScreen("graph")}>
          <AllPapersIcon size={15} />
          <span className="grow">Connections</span>
        </button>
        <button className="nav-item" data-active={s.screen === "discover"} onClick={() => s.openDiscover()}>
          <SearchIcon size={15} />
          <span className="grow">Discover</span>
        </button>
        <div className="watch-row">
          <WatchFolderIcon size={15} />
          <span className="grow">Watch Folder</span>
          <span className="on">on</span>
        </div>
        <button className="nav-item" data-active={s.screen === "settings"} onClick={() => s.goScreen("settings")}>
          <SettingsIcon size={15} />
          <span className="grow">Settings</span>
        </button>
      </div>
    </aside>
  );
}
