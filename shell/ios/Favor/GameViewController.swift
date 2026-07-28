import UIKit
import WebKit

// LAST RESORT — iOS shell. The whole app: the live Pages build full-bleed in a
// WKWebView (same one-codebase pattern as the FAVOR and GVT shells: every web
// ship updates the app instantly, no review needed).
//
// - UA carries "LastResortShell-iOS" so the site can detect the shell later
//   (store rules, shell-only features).
// - localStorage persists via the default website data store — the ghost
//   records and the mute setting survive relaunches.
// - Links leaving the game host open in Safari.
// - Network failure shows a native retry screen instead of a WebKit error.
class GameViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {

    private let gameURL = URL(string: "https://wyattintexas.github.io/last-resort/")!
    private var webView: WKWebView!
    private var retryOverlay: UIView?

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }

    override func viewDidLoad() {
        super.viewDidLoad()
        // the page's own deep-sea backdrop (#062A38) — no white flash on load
        view.backgroundColor = UIColor(red: 0x06 / 255.0, green: 0x2A / 255.0, blue: 0x38 / 255.0, alpha: 1)

        let config = WKWebViewConfiguration()
        config.applicationNameForUserAgent = "LastResortShell-iOS/1.0"
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []   // the GVT ships-silent scar
        config.websiteDataStore = .default()

        let ucc = WKUserContentController()
        let boot = "window.__LRSHELL = { platform: 'ios', build: 1 };"
        ucc.addUserScript(WKUserScript(source: boot, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController = ucc

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = view.backgroundColor
        webView.allowsBackForwardNavigationGestures = false
        view.addSubview(webView)

        webView.load(URLRequest(url: gameURL))
    }

    // External links → Safari; the cove never navigates away.
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url,
           navigationAction.navigationType == .linkActivated,
           url.host != gameURL.host {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showRetry()
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        let e = error as NSError
        if e.code != NSURLErrorCancelled { showRetry() }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        retryOverlay?.removeFromSuperview()
        retryOverlay = nil
    }

    private func showRetry() {
        guard retryOverlay == nil else { return }
        let overlay = UIView(frame: view.bounds)
        overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        overlay.backgroundColor = view.backgroundColor

        let title = UILabel()
        title.text = "THE SEA ATE THE SIGNAL"
        title.font = UIFont(name: "AvenirNextCondensed-Heavy", size: 34) ?? .boldSystemFont(ofSize: 34)
        title.textColor = UIColor(red: 0xE7 / 255.0, green: 0xC2 / 255.0, blue: 0x5C / 255.0, alpha: 1)

        let sub = UILabel()
        sub.text = "No connection to the island. Check your signal and paddle back."
        sub.font = .systemFont(ofSize: 16)
        sub.textColor = UIColor(red: 0x8C / 255.0, green: 0xF0 / 255.0, blue: 0xE4 / 255.0, alpha: 1)
        sub.numberOfLines = 0
        sub.textAlignment = .center

        let btn = UIButton(type: .system)
        btn.setTitle("PADDLE BACK", for: .normal)
        btn.titleLabel?.font = UIFont(name: "AvenirNextCondensed-Bold", size: 22) ?? .boldSystemFont(ofSize: 22)
        btn.setTitleColor(UIColor(red: 0x06 / 255.0, green: 0x20 / 255.0, blue: 0x2B / 255.0, alpha: 1), for: .normal)
        btn.backgroundColor = UIColor(red: 0xE7 / 255.0, green: 0xC2 / 255.0, blue: 0x5C / 255.0, alpha: 1)
        btn.layer.cornerRadius = 2
        btn.contentEdgeInsets = UIEdgeInsets(top: 10, left: 34, bottom: 10, right: 34)
        btn.addAction(UIAction { [weak self] _ in
            guard let self = self else { return }
            self.retryOverlay?.removeFromSuperview()
            self.retryOverlay = nil
            self.webView.load(URLRequest(url: self.gameURL))
        }, for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [title, sub, btn])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        overlay.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: overlay.centerYAnchor),
            stack.widthAnchor.constraint(lessThanOrEqualTo: overlay.widthAnchor, multiplier: 0.8)
        ])

        view.addSubview(overlay)
        retryOverlay = overlay
    }
}
