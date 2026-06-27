import SwiftUI

// The desktop shell: a 3-column NavigationSplitView (filters | library | reader).
struct MacRootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationSplitView {
            MacSidebarView()
                .navigationSplitViewColumnWidth(min: 200, ideal: 232, max: 300)
        } content: {
            MacLibraryView()
                .navigationSplitViewColumnWidth(min: 320, ideal: 440)
        } detail: {
            if let id = model.selectedId, let paper = model.paper(id) {
                MacReaderView(paper: paper)
                    .id(paper.id)
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
