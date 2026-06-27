import SwiftUI
import PDFKit
import UIKit

// Controls the underlying PDFView so SwiftUI toolbar actions (highlight) can reach
// it, and surfaces page changes back to the model.
@Observable
final class PDFController {
    weak var pdfView: PDFView?
    var pageCount = 0

    func goToPage(_ oneBased: Int) {
        guard let v = pdfView, let doc = v.document, oneBased >= 1, oneBased <= doc.pageCount,
              let page = doc.page(at: oneBased - 1) else { return }
        v.go(to: page)
    }

    /// Turn the current text selection into a highlight annotation + a Highlight
    /// record. Returns (text, 1-based page) when something was selected.
    func highlightSelection(color: String) -> (String, Int)? {
        guard let v = pdfView, let doc = v.document,
              let sel = v.currentSelection, !(sel.string ?? "").isEmpty else { return nil }
        var pageNo = 1
        for line in sel.selectionsByLine() {
            guard let page = line.pages.first else { continue }
            pageNo = doc.index(for: page) + 1
            let a = PDFAnnotation(bounds: line.bounds(for: page), forType: .highlight, withProperties: nil)
            a.color = UIColor(Color(hex: color))
            page.addAnnotation(a)
        }
        let text = sel.string ?? ""
        v.clearSelection()
        return (text, pageNo)
    }
}

// UIViewRepresentable wrapper around PDFView. Native PDF rendering, selection and
// annotations — the upgrade over the pdf.js webview.
struct PDFKitView: UIViewRepresentable {
    let url: URL
    let controller: PDFController
    let savedHighlights: [Highlight]
    var initialPage: Int = 1
    var onPageChange: (Int) -> Void = { _ in }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> PDFView {
        let v = PDFView()
        v.autoScales = true
        v.displayMode = .singlePageContinuous
        v.displayDirection = .vertical
        if let doc = PDFDocument(url: url) {
            v.document = doc
            controller.pdfView = v
            controller.pageCount = doc.pageCount
            redrawSavedHighlights(in: doc)
            if initialPage > 1, initialPage <= doc.pageCount, let p = doc.page(at: initialPage - 1) {
                DispatchQueue.main.async { v.go(to: p) }
            }
        }
        NotificationCenter.default.addObserver(
            context.coordinator, selector: #selector(Coordinator.pageChanged(_:)),
            name: .PDFViewPageChanged, object: v)
        return v
    }

    func updateUIView(_ uiView: PDFView, context: Context) {
        controller.pdfView = uiView
    }

    // Re-create annotations for highlights saved in previous sessions by searching
    // each page for the highlighted text.
    private func redrawSavedHighlights(in doc: PDFDocument) {
        for hl in savedHighlights where !hl.text.isEmpty {
            for sel in doc.findString(hl.text, withOptions: .caseInsensitive) {
                for line in sel.selectionsByLine() {
                    guard let page = line.pages.first else { continue }
                    let a = PDFAnnotation(bounds: line.bounds(for: page), forType: .highlight, withProperties: nil)
                    a.color = UIColor(Color(hex: hl.color))
                    page.addAnnotation(a)
                }
            }
        }
    }

    final class Coordinator: NSObject {
        let parent: PDFKitView
        init(_ parent: PDFKitView) { self.parent = parent }
        @objc func pageChanged(_ note: Notification) {
            guard let v = note.object as? PDFView, let doc = v.document, let cur = v.currentPage else { return }
            parent.onPageChange(doc.index(for: cur) + 1)
        }
    }
}
