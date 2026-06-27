import SwiftUI

// The desktop shell: a 3-column NavigationSplitView. The sidebar picks a screen or
// a library filter. The middle column is the list/browse surface; the wide detail
// column is the focused surface — the reader, or a full-canvas screen (Connections
// graph, study sessions) that needs the room.
struct MacRootView: View {
    @Environment(AppModel.self) private var model

    private var isFullCanvas: Bool {
        switch model.screen {
        case .graph, .flashcards, .review: return true
        default: return false
        }
    }

    var body: some View {
        @Bindable var model = model
        NavigationSplitView {
            MacSidebarView()
                .navigationSplitViewColumnWidth(min: 210, ideal: 240, max: 320)
        } content: {
            middleColumn
                .navigationSplitViewColumnWidth(min: 340, ideal: 460)
        } detail: {
            detailColumn
        }
        .preferredColorScheme(model.settings.theme == "dark" ? .dark : .light)
        .sheet(isPresented: $model.presentAdd) { MacAddPaperView().environment(model) }
    }

    // Middle: the browse/list surface. Full-canvas screens keep the library list
    // here for context (their content lives in the wide detail column).
    @ViewBuilder
    private var middleColumn: some View {
        switch model.screen {
        case .dashboard: MacDashboardView()
        case .discover: MacDiscoverView()
        case .feeds: MacFeedsView()
        case .notebook: MacNotebookView()
        case .settings: MacSettingsView()
        default: MacLibraryView()
        }
    }

    // Detail: a full-canvas screen when one is active, else the reader.
    @ViewBuilder
    private var detailColumn: some View {
        switch model.screen {
        case .graph: MacGraphView()
        case .flashcards: MacFlashcardsView()
        case .review: MacReviewView()
        default:
            if let id = model.selectedId, let paper = model.paper(id) {
                MacReaderView(paper: paper).id(paper.id)
            } else {
                ContentUnavailableView(
                    "No paper selected",
                    systemImage: "doc.text",
                    description: Text("Pick a paper from your library to read it.")
                )
            }
        }
    }
}
