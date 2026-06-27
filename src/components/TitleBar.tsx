import type { Store } from "../store";
import { isTauri } from "../lib/tauri";
import {
  CardIcon,
  ListIcon,
  PlusIcon,
  SearchIcon,
  SidebarIcon,
} from "../icons";

export function TitleBar({ store: s }: { store: Store }) {
  // In the native window macOS draws the real traffic lights, so we drop the
  // mockup ones and leave room for the overlaid controls instead.
  const native = isTauri();
  return (
    <div
      className="titlebar"
      data-tauri-drag-region
      style={native ? { paddingLeft: 82 } : undefined}
    >
      {!native && (
        <div className="traffic-lights">
          <span style={{ background: "#FF5F57" }} />
          <span style={{ background: "#FEBC2E" }} />
          <span style={{ background: "#28C840" }} />
        </div>
      )}

      <button
        className="icon-btn"
        title={s.narrow ? "Menu" : "Toggle sidebar"}
        onClick={s.narrow ? s.toggleDrawer : s.toggleSidebar}
      >
        <SidebarIcon size={16} />
      </button>

      <button className="search-trigger" onClick={s.openPalette}>
        <SearchIcon size={14} />
        <span style={{ flex: 1, textAlign: "left" }}>Search library…</span>
        <kbd>⌘K</kbd>
      </button>

      <div className="spacer" />

      <div className="segmented">
        <button
          className="seg-btn"
          data-active={s.view === "table"}
          title="List view"
          onClick={() => s.setView("table")}
        >
          <ListIcon size={15} />
        </button>
        <button
          className="seg-btn"
          data-active={s.view === "card"}
          title="Card view"
          onClick={() => s.setView("card")}
        >
          <CardIcon size={15} />
        </button>
      </div>

      <button className="icon-btn bordered" title="Toggle theme" onClick={s.toggleTheme}>
        <span>{s.theme === "dark" ? "☀" : "☾"}</span>
      </button>

      <button className="btn-ghost" onClick={s.openIdentifier}>
        Add by ID
      </button>

      <button className="btn-primary" onClick={s.importFiles}>
        <PlusIcon size={13} />
        Import
      </button>
    </div>
  );
}
