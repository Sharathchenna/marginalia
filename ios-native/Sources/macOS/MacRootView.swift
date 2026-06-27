import SwiftUI

// The desktop shell: a 3-column NavigationSplitView. The sidebar picks a screen or
// a library filter; the content column swaps to match; the detail column is the
// reader for the selected paper.
struct MacRootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationSplitView {
            MacSidebarView()
                .navigationSplitViewColumnWidth(min: 210, ideal: 240, max: 320)
        } content: {
            content
                .navigationSplitViewColumnWidth(min: 340, ideal: 460)
        } detail: {
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

    @ViewBuilder
    private var content: some View {
        switch model.screen {
        case .dashboard: MacDashboardView()
        case .discover: MacDiscoverView()
        case .feeds: MacFeedsView()
        case .notebook: MacNotebookView()
        case .flashcards: MacFlashcardsView()
        case .review: MacReviewView()
        case .graph: MacGraphView()
        case .settings: MacSettingsView()
        default: MacLibraryView()   // .library / .reader / .onboarding
        }
    }
}
