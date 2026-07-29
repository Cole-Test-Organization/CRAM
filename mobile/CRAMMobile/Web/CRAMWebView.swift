import SwiftUI
import UIKit
import WebKit

struct CRAMWebView: UIViewRepresentable {
    let session: ClientSession
    let initialPath: String
    let onOpenMeetingNotes: (Int) -> Void
    let onOpenSettings: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let userContentController = WKUserContentController()
        let bridge = MobileBridgeHandler(
            cache: session.cache,
            onOpenMeetingNotes: onOpenMeetingNotes,
            onOpenSettings: onOpenSettings
        )
        userContentController.addScriptMessageHandler(
            bridge,
            contentWorld: .page,
            name: "cramMobile"
        )
        userContentController.addUserScript(WKUserScript(
            source: MobileBridgeScript.source,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false,
            in: .page
        ))

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = userContentController
        configuration.websiteDataStore = session.websiteDataStore
        configuration.setURLSchemeHandler(
            session.schemeHandler,
            forURLScheme: AppSchemeHandler.scheme
        )
        configuration.allowsInlineMediaPlayback = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.customUserAgent = "CRAM-Mobile/1.0"
        webView.isInspectable = true
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.09, green: 0.075, blue: 0.06, alpha: 1)
        webView.scrollView.backgroundColor = webView.backgroundColor
        webView.allowsBackForwardNavigationGestures = true
        context.coordinator.bridge = bridge

        var components = URLComponents()
        components.scheme = AppSchemeHandler.scheme
        components.host = AppSchemeHandler.host
        components.path = initialPath.hasPrefix("/") ? initialPath : "/\(initialPath)"
        if let url = components.url {
            webView.load(URLRequest(url: url))
        }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        var bridge: MobileBridgeHandler?

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }
            if url.scheme == AppSchemeHandler.scheme && url.host == AppSchemeHandler.host {
                decisionHandler(.allow)
                return
            }
            if ["https", "http", "mailto", "tel"].contains(url.scheme?.lowercased() ?? "") {
                UIApplication.shared.open(url)
            }
            decisionHandler(.cancel)
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if let url = navigationAction.request.url,
               ["https", "http", "mailto", "tel"].contains(url.scheme?.lowercased() ?? "") {
                UIApplication.shared.open(url)
            }
            return nil
        }

        func webView(
            _ webView: WKWebView,
            runJavaScriptAlertPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping () -> Void
        ) {
            let alert = UIAlertController(title: "CRAM", message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
                completionHandler()
            })
            present(alert, from: webView)
        }

        func webView(
            _ webView: WKWebView,
            runJavaScriptConfirmPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping (Bool) -> Void
        ) {
            let alert = UIAlertController(title: "CRAM", message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in
                completionHandler(false)
            })
            alert.addAction(UIAlertAction(title: "Continue", style: .destructive) { _ in
                completionHandler(true)
            })
            present(alert, from: webView)
        }

        private func present(_ controller: UIViewController, from webView: WKWebView) {
            var presenter = webView.window?.rootViewController
            while let presented = presenter?.presentedViewController {
                presenter = presented
            }
            presenter?.present(controller, animated: true)
        }
    }
}
