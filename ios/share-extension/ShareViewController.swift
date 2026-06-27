import UIKit
import Social
import UniformTypeIdentifiers

// Marginalia Share Extension — "Share → Marginalia" from Safari or any app.
// It grabs the shared URL (or the first URL in shared text) and opens the main
// app via the `marginalia://add?u=<url>` deep link, which the app routes into its
// existing capture pipeline (see route_deep_link in src-tauri/src/lib.rs).
// No App Group is required for this URL-passing flow.
class ShareViewController: UIViewController {
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard
            let item = extensionContext?.inputItems.first as? NSExtensionItem,
            let provider = item.attachments?.first
        else {
            finish()
            return
        }

        let urlType = UTType.url.identifier
        let textType = UTType.text.identifier

        if provider.hasItemConformingToTypeIdentifier(urlType) {
            provider.loadItem(forTypeIdentifier: urlType, options: nil) { [weak self] data, _ in
                if let url = data as? URL {
                    self?.capture(url.absoluteString)
                } else {
                    self?.finish()
                }
            }
        } else if provider.hasItemConformingToTypeIdentifier(textType) {
            provider.loadItem(forTypeIdentifier: textType, options: nil) { [weak self] data, _ in
                if let text = data as? String, let u = self?.firstURL(in: text) {
                    self?.capture(u)
                } else {
                    self?.finish()
                }
            }
        } else {
            finish()
        }
    }

    private func firstURL(in text: String) -> String? {
        let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
        let range = NSRange(text.startIndex..., in: text)
        return detector?.firstMatch(in: text, range: range)?.url?.absoluteString
    }

    private func capture(_ urlString: String) {
        // Percent-encode aggressively; the app's route_deep_link decodes it.
        let encoded = urlString.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? urlString
        if let deepLink = URL(string: "marginalia://add?u=\(encoded)") {
            openURL(deepLink)
        }
        finish()
    }

    // Extensions can't call UIApplication.shared.open directly — walk the responder
    // chain to reach the UIApplication and open the host-app deep link.
    @discardableResult
    private func openURL(_ url: URL) -> Bool {
        var responder: UIResponder? = self
        while let current = responder {
            if let app = current as? UIApplication {
                app.open(url, options: [:], completionHandler: nil)
                return true
            }
            responder = current.next
        }
        return false
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}
