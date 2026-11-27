import SwiftUI
import WebKit

struct RootView: View {
    @EnvironmentObject private var session: AppSession
    @State private var showUrlPicker = false
    @State private var customUrlInput = ""

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color(red: 5/255, green: 5/255, blue: 5/255)
                .ignoresSafeArea()

            WebView(url: URL(string: session.apiBase) ?? URL(string: "https://library.example.com")!)
                .ignoresSafeArea()

            #if os(macOS)
            Button(action: {
                customUrlInput = session.apiBase
                showUrlPicker = true
            }) {
                Image(systemName: "network")
                    .font(.system(size: 14, weight: .medium))
                    .padding(8)
                    .background(Color.black.opacity(0.6))
                    .foregroundStyle(.white)
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .padding(12)
            #endif
        }
        .sheet(isPresented: $showUrlPicker) {
            VStack(spacing: 16) {
                Text("Sunucu Adresi (Server URL)")
                    .font(.headline)
                TextField("https://library.example.com", text: $customUrlInput)
                    .textFieldStyle(.roundedBorder)
                    .frame(minWidth: 320)
                HStack {
                    Button("Vazgeç") { showUrlPicker = false }
                    Button("Kaydet ve Yenile") {
                        session.apiBase = customUrlInput
                        session.saveSettings()
                        showUrlPicker = false
                    }
                    .keyboardShortcut(.defaultAction)
                }
            }
            .padding(24)
        }
    }
}

#if os(macOS)
struct WebView: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) DijitalKutuphaneNative/1.0"
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        if webView.url?.host != url.host || webView.url?.port != url.port {
            webView.load(URLRequest(url: url))
        }
    }
}
#else
struct WebView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 DijitalKutuphaneNative/1.0"
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        if webView.url?.host != url.host || webView.url?.port != url.port {
            webView.load(URLRequest(url: url))
        }
    }
}
#endif
