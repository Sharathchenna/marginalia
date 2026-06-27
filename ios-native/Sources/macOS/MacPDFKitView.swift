import SwiftUI
import PDFKit
import AppKit

// A PDFKit reader controller for macOS: loads a document, restores saved
// highlights, lets the user highlight the current text selection, tracks the
// page for resume, and jumps to a page. The macOS analogue of PDFKitView.swift.
@MainActor
final class MacPDFController: ObservableObject {
    let view: PDFView = {
        let v = PDFView()
        v.autoScales = true
        v.displayMode = .singlePageContinuous
        v.displayDirection = .vertical
        return v
    }()

    var onPageChange: ((Int) -> Void)?
    private var loadedURL: URL?
    private var observer: NSObjectProtocol?

    init() {
        observer = NotificationCenter.default.addObserver(
            forName: .PDFViewPageChanged, object: view, queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in self.onPageChange?(self.currentPage) }
        }
    }
    deinit { if let observer { NotificationCenter.default.removeObserver(observer) } }

    func load(url: URL, savedHighlights: [Highlight], startPage: Int) {
        guard loadedURL != url, let doc = PDFDocument(url: url) else { return }
        loadedURL = url
        view.document = doc
        restore(savedHighlights, in: doc)
        if startPage > 1, startPage <= doc.pageCount, let page = doc.page(at: startPage - 1) {
            DispatchQueue.main.async { [weak self] in self?.view.go(to: page) }
        }
    }

    var pageCount: Int { view.document?.pageCount ?? 0 }
    var currentPage: Int {
        guard let page = view.currentPage, let doc = view.document else { return 1 }
        return doc.index(for: page) + 1
    }

    func goToPage(_ oneBased: Int) {
        guard let doc = view.document, oneBased >= 1, oneBased <= doc.pageCount,
              let page = doc.page(at: oneBased - 1) else { return }
        view.go(to: page)
    }

    /// Highlight the current selection; returns its text + 1-based page.
    func highlightSelection(colorHex: String) -> (text: String, page: Int)? {
        guard let sel = view.currentSelection, let doc = view.document else { return nil }
        let text = sel.string ?? ""
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        var firstPage = 1
        for line in sel.selectionsByLine() {
            guard let page = line.pages.first else { continue }
            firstPage = doc.index(for: page) + 1
            let ann = PDFAnnotation(bounds: line.bounds(for: page), forType: .highlight, withProperties: nil)
            ann.color = Self.nsColor(colorHex)
            page.addAnnotation(ann)
        }
        view.clearSelection()
        return (text, firstPage)
    }

    private func restore(_ highlights: [Highlight], in doc: PDFDocument) {
        for h in highlights where !h.text.isEmpty {
            let matches = doc.findString(h.text, withOptions: [.caseInsensitive])
            // Prefer a match on the saved page; else the first match.
            let chosen = matches.first { ($0.pages.first.map { doc.index(for: $0) + 1 }) == h.page } ?? matches.first
            guard let sel = chosen else { continue }
            for line in sel.selectionsByLine() {
                guard let page = line.pages.first else { continue }
                let ann = PDFAnnotation(bounds: line.bounds(for: page), forType: .highlight, withProperties: nil)
                ann.color = Self.nsColor(h.color)
                page.addAnnotation(ann)
            }
        }
    }

    static func nsColor(_ hex: String) -> NSColor {
        let s = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var v: UInt64 = 0
        Scanner(string: s).scanHexInt64(&v)
        guard s.count == 6 else { return NSColor.systemYellow.withAlphaComponent(0.45) }
        return NSColor(
            red: CGFloat((v & 0xFF0000) >> 16) / 255,
            green: CGFloat((v & 0x00FF00) >> 8) / 255,
            blue: CGFloat(v & 0x0000FF) / 255,
            alpha: 0.45
        )
    }
}

struct MacPDFKitView: NSViewRepresentable {
    let controller: MacPDFController
    func makeNSView(context: Context) -> PDFView { controller.view }
    func updateNSView(_ nsView: PDFView, context: Context) {}
}
