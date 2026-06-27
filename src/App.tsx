import { useStore } from "./store";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { Dashboard } from "./components/Dashboard";
import { Library } from "./components/Library";
import { Reader } from "./components/Reader";
import { Notebook } from "./components/Notebook";
import { GraphView } from "./components/GraphView";
import { Flashcards } from "./components/Flashcards";
import { Discover } from "./components/Discover";
import { Feeds } from "./components/Feeds";
import { Review } from "./components/Review";
import { Settings } from "./components/Settings";
import { Onboarding } from "./components/Onboarding";
import { CommandPalette } from "./components/CommandPalette";
import { ImportModal, AddByIdModal, CiteModal, DuplicatesModal, ClaimModal, DialogModal, ShortcutsModal } from "./components/Modals";
import { ChatPanel } from "./components/ChatPanel";
import { Toast } from "./components/Toast";

export default function App() {
  const s = useStore();

  return (
    <div
      className="app-shell"
      data-theme={s.theme}
      data-density={s.density}
      data-glass={s.glassMode}
      data-narrow={s.narrow}
    >
      <TitleBar store={s} />

      {!s.loaded ? (
        <div style={{ flex: 1, display: "grid", placeItems: "center", color: "var(--text-3)", fontSize: 13 }}>
          Loading library…
        </div>
      ) : (
      <div className="body">
        {/* Desktop: inline sidebar. Narrow: an off-canvas drawer + scrim. */}
        {!s.narrow && s.showSidebar && <Sidebar store={s} />}
        {s.narrow && s.drawerOpen && (
          <>
            <div className="drawer-scrim" onClick={s.closeDrawer} />
            <div className="sidebar-drawer">
              <Sidebar store={s} />
            </div>
          </>
        )}

        {s.screen === "dashboard" && <Dashboard store={s} />}
        {s.screen === "library" && <Library store={s} />}
        {s.screen === "reader" && <Reader store={s} />}
        {s.screen === "notebook" && <Notebook store={s} />}
        {s.screen === "graph" && <GraphView store={s} />}
        {s.screen === "flashcards" && <Flashcards store={s} />}
        {s.screen === "discover" && <Discover store={s} />}
        {s.screen === "feeds" && <Feeds store={s} />}
        {s.screen === "review" && <Review store={s} />}
        {s.screen === "settings" && <Settings store={s} />}
      </div>
      )}

      {s.screen === "onboarding" && <Onboarding store={s} />}

      {s.palette && <CommandPalette store={s} />}
      {s.importOpen && <ImportModal store={s} />}
      {s.idOpen && <AddByIdModal store={s} />}
      {s.citeOpen && <CiteModal store={s} />}
      {s.dupOpen && <DuplicatesModal store={s} />}
      {s.claimOpen && <ClaimModal store={s} />}
      {/* In the reader the chat is embedded in the right sidebar (see Reader);
          elsewhere (e.g. "Ask your library") it floats as a drawer. */}
      {s.chatOpen && s.screen !== "reader" && <ChatPanel store={s} />}
      {s.toast && <Toast message={s.toast} kind={s.toastKind} />}
      {s.dialog && <DialogModal store={s} />}
      {s.shortcutsOpen && <ShortcutsModal store={s} />}
    </div>
  );
}
