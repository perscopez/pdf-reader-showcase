import Foundation
import CryptoKit
import AVFoundation

@MainActor
final class AppSession: ObservableObject {
    @Published var apiBase = UserDefaults.standard.string(forKey: "apiBase") ?? "https://library.example.com"
    @Published var username = UserDefaults.standard.string(forKey: "username") ?? ""
    @Published var password = ""
    @Published var user: NativeUser?
    @Published var books: [Book] = []
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var selectedBook: Book?
    @Published var downloadedPDF: URL?
    private var vaultKey: SymmetricKey?
    private var audioPlayer: AVAudioPlayer?

    private let client = NativeAPIClient()

    var isLoggedIn: Bool { user != nil }

    func saveSettings() {
        UserDefaults.standard.set(apiBase, forKey: "apiBase")
        UserDefaults.standard.set(username, forKey: "username")
    }

    func login() async {
        isLoading = true
        errorMessage = nil
        saveSettings()
        do {
            let loggedIn = try await client.login(apiBase: apiBase, username: username, password: password)
            user = loggedIn
            if let salt = loggedIn.vaultSalt, let wrapped = loggedIn.wrappedVaultKey, !salt.isEmpty, !wrapped.isEmpty {
                let passwordKey = try NativeCrypto.derivePasswordKey(password: password, saltHex: salt)
                vaultKey = try NativeCrypto.unwrapWebKey(wrappedKeyHex: wrapped, wrappingKey: passwordKey)
            } else {
                vaultKey = nil
            }
            password = ""
            try await loadBooks()
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    func loadBooks() async throws {
        books = try await client.fetchBooks(apiBase: apiBase)
    }

    func refreshBooks() async {
        isLoading = true
        errorMessage = nil
        do { try await loadBooks() } catch { errorMessage = error.localizedDescription }
        isLoading = false
    }

    func open(_ book: Book) async {
        selectedBook = book
        downloadedPDF = nil
        errorMessage = nil
        isLoading = true
        do {
            downloadedPDF = try await client.downloadPDF(apiBase: apiBase, book: book, vaultKey: vaultKey)
            await saveProgress(book: book, page: book.lastPage)
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    func updateBook(_ book: Book, title: String, author: String, category: String, status: String, favorite: Bool? = nil) async {
        isLoading = true
        errorMessage = nil
        do {
            _ = try await client.updateBook(apiBase: apiBase, book: book, title: title, author: author, category: category, status: status, favorite: favorite ?? ((book.favorite ?? 0) == 1))
            try await loadBooks()
        } catch { errorMessage = error.localizedDescription }
        isLoading = false
    }

    func toggleFavorite(_ book: Book) async {
        await updateBook(book, title: book.title, author: book.displayAuthor, category: book.category ?? "PDF", status: book.status ?? "reading", favorite: (book.favorite ?? 0) != 1)
    }

    func deleteBook(_ book: Book) async {
        isLoading = true
        errorMessage = nil
        do {
            try await client.deleteBook(apiBase: apiBase, bookID: book.id)
            if selectedBook?.id == book.id { selectedBook = nil; downloadedPDF = nil }
            try await loadBooks()
        } catch { errorMessage = error.localizedDescription }
        isLoading = false
    }

    func searchSources(query: String) async throws -> [SourceResult] {
        try await client.searchSources(apiBase: apiBase, query: query)
    }

    func importSource(_ result: SourceResult) async {
        isLoading = true
        errorMessage = nil
        do {
            _ = try await client.importSource(apiBase: apiBase, result: result)
            try await loadBooks()
        } catch { errorMessage = error.localizedDescription }
        isLoading = false
    }

    func saveProgress(book: Book, page: Int) async {
        do { try await client.updateProgress(apiBase: apiBase, bookID: book.id, page: page) }
        catch { print("Progress save failed: \(error)") }
    }
    func loadBookmarks(book: Book) async throws -> [Bookmark] {
        try await client.fetchBookmarks(apiBase: apiBase, bookID: book.id)
    }

    func addBookmark(book: Book, page: Int) async throws -> Bookmark {
        try await client.addBookmark(apiBase: apiBase, bookID: book.id, page: page)
    }

    func deleteBookmark(_ bookmark: Bookmark) async throws {
        try await client.deleteBookmark(apiBase: apiBase, bookmarkID: bookmark.id)
    }

    func loadWords() async throws -> [WordEntry] {
        try await client.fetchWords(apiBase: apiBase)
    }

    func lookupWord(_ word: String) async throws -> String {
        try await client.lookupWord(apiBase: apiBase, word: word)
    }

    func addWord(word: String, definition: String) async throws -> WordEntry {
        try await client.addWord(apiBase: apiBase, word: word, definition: definition)
    }

    func deleteWord(_ entry: WordEntry) async throws {
        try await client.deleteWord(apiBase: apiBase, id: entry.id)
    }

    func askAI(book: Book, page: Int, question: String) async throws -> String {
        try await client.askAI(apiBase: apiBase, bookID: book.id, page: page, question: question)
    }

    func pageText(book: Book, page: Int) async throws -> String {
        try await client.pageText(apiBase: apiBase, bookID: book.id, page: page)
    }

    func readingSessions(book: Book) async throws -> String {
        try await client.readingSessions(apiBase: apiBase, bookID: book.id)
    }

    func recordReadingSession(book: Book, page: Int, durationSeconds: Int = 600) async throws -> String {
        try await client.recordReadingSession(apiBase: apiBase, bookID: book.id, page: page, durationSeconds: durationSeconds)
    }

    func translateText(_ text: String, target: String) async throws -> String {
        try await client.translateText(apiBase: apiBase, text: text, target: target)
    }

    func speakText(_ text: String) async throws {
        let url = try await client.synthesizeSpeech(apiBase: apiBase, text: text)
        audioPlayer = try AVAudioPlayer(contentsOf: url)
        audioPlayer?.prepareToPlay()
        audioPlayer?.play()
    }

    func loadNotes(book: Book) async throws -> [NoteAnnotation] {
        try await client.fetchNotes(apiBase: apiBase, bookID: book.id)
    }

    func addNote(book: Book, page: Int, note: String) async throws -> NoteAnnotation {
        try await client.addNote(apiBase: apiBase, bookID: book.id, page: page, note: note)
    }

    func deleteNote(_ note: NoteAnnotation) async throws {
        try await client.deleteNote(apiBase: apiBase, id: note.id)
    }

    func searchContent(_ query: String) async throws -> [SearchResult] {
        try await client.searchContent(apiBase: apiBase, query: query)
    }

    func readingSummary() async throws -> String {
        try await client.readingSummary(apiBase: apiBase)
    }

    func sendBugReport(_ message: String) async throws {
        try await client.sendBugReport(apiBase: apiBase, message: message, pageUrl: "native-apple")
    }


    func syncStatus() async throws -> String {
        try await client.syncStatus(apiBase: apiBase)
    }


    func accountStatus() async throws -> String { try await client.accountStatus(apiBase: apiBase) }
    func updateProfileUsername(_ username: String) async throws -> String { try await client.updateProfileUsername(apiBase: apiBase, username: username) }
    func registerAccount(username: String, password: String, email: String, inviteCode: String) async throws -> String { try await client.registerAccount(apiBase: apiBase, username: username, password: password, email: email, inviteCode: inviteCode) }
    func recoverVault(username: String) async throws -> String { try await client.recoverVault(apiBase: apiBase, username: username) }
    func resendVerification(email: String) async throws -> String { try await client.resendVerification(apiBase: apiBase, email: email) }
    func restoreAccount(username: String, password: String) async throws -> String { try await client.restoreAccount(apiBase: apiBase, username: username, password: password) }
    func sendDmcaPlaceholder() async throws -> String { try await client.sendDmcaPlaceholder(apiBase: apiBase) }

    func downloadBackup() async throws -> URL {
        try await client.downloadFile(apiBase: apiBase, path: "/api/backup", filename: "kisisel-kutuphane-backup.zip")
    }

    func exportBook(_ book: Book) async throws -> URL {
        let safe = book.title.replacingOccurrences(of: "[^A-Za-z0-9._-]+", with: "-", options: .regularExpression)
        return try await client.downloadFile(apiBase: apiBase, path: "/api/books/\(book.id)/export", filename: "\(safe)-annotated.pdf")
    }

    func logout() async {
        try? await client.logout(apiBase: apiBase)
        user = nil; books = []; selectedBook = nil; downloadedPDF = nil
    }
}

enum NativeAPIError: LocalizedError {
    case invalidURL
    case badStatus(Int, String)
    case unsupported(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Geçersiz VPS URL"
        case .badStatus(let status, let body): return "Sunucu hatası \(status): \(body)"
        case .unsupported(let message): return message
        }
    }
}

@MainActor
final class NativeAPIClient {
    private let session: URLSession

    init() {
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = .shared
        config.httpShouldSetCookies = true
        config.httpCookieAcceptPolicy = .always
        self.session = URLSession(configuration: config)
    }

    func login(apiBase: String, username: String, password: String) async throws -> NativeUser {
        var request = try jsonRequest(apiBase: apiBase, path: "/api/auth/login", method: "POST")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["username": username, "password": password])
        let data = try await checkedData(for: request)
        let decoded = try JSONDecoder().decode(LoginResponse.self, from: data)
        return decoded.user
    }

    func fetchBooks(apiBase: String) async throws -> [Book] {
        let request = try jsonRequest(apiBase: apiBase, path: "/api/books", method: "GET")
        let data = try await checkedData(for: request)
        return try JSONDecoder().decode([Book].self, from: data)
    }

    func updateProgress(apiBase: String, bookID: Int, page: Int) async throws {
        var request = try jsonRequest(apiBase: apiBase, path: "/api/books/\(bookID)", method: "PATCH")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "last_page": max(1, page),
            "last_opened_at": ISO8601DateFormatter().string(from: Date())
        ])
        _ = try await checkedData(for: request)
    }

    func updateBook(apiBase: String, book: Book, title: String, author: String, category: String, status: String, favorite: Bool) async throws -> Book {
        var request = try jsonRequest(apiBase: apiBase, path: "/api/books/\(book.id)", method: "PATCH")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "title": title,
            "author": author,
            "category": category,
            "status": status,
            "favorite": favorite ? 1 : 0
        ])
        let data = try await checkedData(for: request)
        return try JSONDecoder().decode(Book.self, from: data)
    }

    func deleteBook(apiBase: String, bookID: Int) async throws {
        var request = URLRequest(url: try buildURL(apiBase: apiBase, path: "/api/books/\(bookID)"))
        request.httpMethod = "DELETE"
        _ = try await checkedData(for: request)
    }

    func searchSources(apiBase: String, query: String) async throws -> [SourceResult] {
        var components = URLComponents(url: try buildURL(apiBase: apiBase, path: "/api/books/search-source"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "q", value: query)]
        guard let url = components?.url else { throw NativeAPIError.invalidURL }
        let data = try await checkedData(for: URLRequest(url: url))
        return try JSONDecoder().decode(SourceSearchResponse.self, from: data).results
    }

    func importSource(apiBase: String, result: SourceResult) async throws -> Book {
        guard let downloadUrl = result.downloadUrl, !downloadUrl.isEmpty else { throw NativeAPIError.unsupported("Bu kaynakta indirilebilir PDF/EPUB yok.") }
        var request = try jsonRequest(apiBase: apiBase, path: "/api/books/import", method: "POST")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "downloadUrl": downloadUrl,
            "title": result.title,
            "author": result.author,
            "source": result.source,
            "sourceId": result.sourceId
        ])
        let data = try await checkedData(for: request)
        return try JSONDecoder().decode(Book.self, from: data)
    }

    func fetchBookmarks(apiBase: String, bookID: Int) async throws -> [Bookmark] {
        var components = URLComponents(url: try buildURL(apiBase: apiBase, path: "/api/bookmarks"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "book_id", value: String(bookID))]
        guard let url = components?.url else { throw NativeAPIError.invalidURL }
        let data = try await checkedData(for: URLRequest(url: url))
        return try JSONDecoder().decode([Bookmark].self, from: data)
    }

    func addBookmark(apiBase: String, bookID: Int, page: Int) async throws -> Bookmark {
        var request = try jsonRequest(apiBase: apiBase, path: "/api/bookmarks", method: "POST")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "book_id": bookID,
            "page": max(1, page),
            "label": "Sayfa \(max(1, page))"
        ])
        let data = try await checkedData(for: request)
        return try JSONDecoder().decode(Bookmark.self, from: data)
    }

    func deleteBookmark(apiBase: String, bookmarkID: Int) async throws {
        var components = URLComponents(url: try buildURL(apiBase: apiBase, path: "/api/bookmarks"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "id", value: String(bookmarkID))]
        guard let url = components?.url else { throw NativeAPIError.invalidURL }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        _ = try await checkedData(for: request)
    }

    func fetchWords(apiBase: String) async throws -> [WordEntry] {
        let data = try await checkedData(for: try jsonRequest(apiBase: apiBase, path: "/api/words", method: "GET"))
        return try JSONDecoder().decode([WordEntry].self, from: data)
    }

    func addWord(apiBase: String, word: String, definition: String) async throws -> WordEntry {
        var request = try jsonRequest(apiBase: apiBase, path: "/api/words", method: "POST")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["word": word, "definition": definition, "context": "Native app"])
        let data = try await checkedData(for: request)
        return try JSONDecoder().decode(WordEntry.self, from: data)
    }

    func deleteWord(apiBase: String, id: Int) async throws {
        var components = URLComponents(url: try buildURL(apiBase: apiBase, path: "/api/words"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "id", value: String(id))]
        guard let url = components?.url else { throw NativeAPIError.invalidURL }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        _ = try await checkedData(for: request)
    }

    func lookupWord(apiBase: String, word: String) async throws -> String {
        if let tdk = try? await lookupTDK(apiBase: apiBase, word: word), !tdk.isEmpty { return tdk }
        var components = URLComponents(url: try buildURL(apiBase: apiBase, path: "/api/dictionary"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "word", value: word)]
        guard let url = components?.url else { throw NativeAPIError.invalidURL }
        let data = try await checkedData(for: URLRequest(url: url))
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let meanings = json?["meanings"] as? [[String: Any]] ?? []
        let lines = meanings.flatMap { meaning -> [String] in
            let defs = meaning["definitions"] as? [[String: Any]] ?? []
            return defs.prefix(2).compactMap { $0["definition"] as? String }.map { "• \($0)" }
        }
        return lines.prefix(4).joined(separator: "\n")
    }

    private func lookupTDK(apiBase: String, word: String) async throws -> String {
        var components = URLComponents(url: try buildURL(apiBase: apiBase, path: "/api/tdk"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "q", value: word)]
        guard let url = components?.url else { throw NativeAPIError.invalidURL }
        let data = try await checkedData(for: URLRequest(url: url))
        let json = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] ?? []
        let defs = json.first?["definitions"] as? [[String: Any]] ?? []
        return defs.prefix(3).compactMap { $0["anlam"] as? String }.map { "• \($0)" }.joined(separator: "\n")
    }

    func pageText(apiBase: String, bookID: Int, page: Int) async throws -> String {
        var components = URLComponents(url: try buildURL(apiBase: apiBase, path: "/api/books/\(bookID)/page-text"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "page", value: String(max(1, page)))]
        guard let url = components?.url else { throw NativeAPIError.invalidURL }
        let data = try await checkedData(for: URLRequest(url: url))
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        return (json?["text"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Bu sayfada çıkarılmış metin yok."
    }

    func readingSessions(apiBase: String, bookID: Int) async throws -> String {
        let request = try jsonRequest(apiBase: apiBase, path: "/api/books/\(bookID)/sessions", method: "GET")
        let data = try await checkedData(for: request)
        let json = (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        let totals = json["totals"] as? [String: Any] ?? [:]
        let today = json["today"] as? [String: Any] ?? [:]
        let last7 = json["last7"] as? [String: Any] ?? [:]
        func int(_ dict: [String: Any], _ key: String) -> Int { (dict[key] as? NSNumber)?.intValue ?? dict[key] as? Int ?? 0 }
        return "Toplam: \(int(totals, "total_seconds") / 60) dk · \(int(totals, "total_pages")) sayfa · \(int(totals, "session_count")) oturum\nBugün: \(int(today, "seconds") / 60) dk · \(int(today, "pages")) sayfa\nSon 7 gün: \(int(last7, "seconds") / 60) dk · \(int(last7, "pages")) sayfa"
    }

    func recordReadingSession(apiBase: String, bookID: Int, page: Int, durationSeconds: Int) async throws -> String {
        let now = ISO8601DateFormatter().string(from: Date())
        var request = try jsonRequest(apiBase: apiBase, path: "/api/books/\(bookID)/sessions", method: "POST")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "start_page": max(1, page),
            "end_page": max(1, page),
            "pages_read": 1,
            "duration_seconds": max(6, durationSeconds),
            "started_at": now,
            "ended_at": now
        ])
        _ = try await checkedData(for: request)
        return "Okuma oturumu kaydedildi."
    }

    func askAI(apiBase: String, bookID: Int, page: Int, question: String) async throws -> String {
        var request = try jsonRequest(apiBase: apiBase, path: "/api/ask-ai", method: "POST")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["bookId": bookID, "question": question, "currentPage": max(1, page)])
        let data = try await checkedData(for: request)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        return json?["answer"] as? String ?? String(data: data, encoding: .utf8) ?? ""
    }

    func translateText(apiBase: String, text: String, target: String) async throws -> String {
        var request = try jsonRequest(apiBase: apiBase, path: "/api/translate", method: "POST")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["text": text, "target_lang": target])
        let data = try await checkedData(for: request)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        return json?["translation"] as? String ?? json?["error"] as? String ?? ""
    }

    func synthesizeSpeech(apiBase: String, text: String, voice: String = "tr-TR-Standard-A", rate: Double = 1.0) async throws -> URL {
        var request = try jsonRequest(apiBase: apiBase, path: "/api/tts", method: "POST")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["text": String(text.prefix(5000)), "voice": voice, "rate": rate])
        let data = try await checkedData(for: request)
        let cacheDir = try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("PDFReaderNative", isDirectory: true)
        try FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
        let url = cacheDir.appendingPathComponent("tts-\(Int(Date().timeIntervalSince1970 * 1000)).mp3")
        try data.write(to: url, options: .atomic)
        return url
    }

    func fetchNotes(apiBase: String, bookID: Int) async throws -> [NoteAnnotation] {
        var components = URLComponents(url: try buildURL(apiBase: apiBase, path: "/api/annotations"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "book_id", value: String(bookID))]
        guard let url = components?.url else { throw NativeAPIError.invalidURL }
        let data = try await checkedData(for: URLRequest(url: url))
        return try JSONDecoder().decode([NoteAnnotation].self, from: data).filter { $0.type == "note" }
    }

    func addNote(apiBase: String, bookID: Int, page: Int, note: String) async throws -> NoteAnnotation {
        var request = try jsonRequest(apiBase: apiBase, path: "/api/annotations", method: "POST")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "book_id": bookID,
            "type": "note",
            "content": ["note": note],
            "page": max(1, page)
        ])
        let data = try await checkedData(for: request)
        return try JSONDecoder().decode(NoteAnnotation.self, from: data)
    }

    func deleteNote(apiBase: String, id: Int) async throws {
        var components = URLComponents(url: try buildURL(apiBase: apiBase, path: "/api/annotations"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "id", value: String(id))]
        guard let url = components?.url else { throw NativeAPIError.invalidURL }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        _ = try await checkedData(for: request)
    }

    func searchContent(apiBase: String, query: String) async throws -> [SearchResult] {
        var components = URLComponents(url: try buildURL(apiBase: apiBase, path: "/api/search"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "q", value: query)]
        guard let url = components?.url else { throw NativeAPIError.invalidURL }
        let data = try await checkedData(for: URLRequest(url: url))
        return try JSONDecoder().decode([SearchResult].self, from: data)
    }

    func readingSummary(apiBase: String) async throws -> String {
        let data = try await checkedData(for: try jsonRequest(apiBase: apiBase, path: "/api/reading-summary", method: "GET"))
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        func line(_ key: String) -> String {
            let p = json[key] as? [String: Any] ?? [:]
            let minutes = ((p["seconds"] as? Int) ?? 0) / 60
            return "\(key == "today" ? "Bugün" : "Hafta"): \(minutes) dk · \((p["pages"] as? Int) ?? 0) sayfa · \((p["sessions"] as? Int) ?? 0) oturum"
        }
        return line("today") + "\n" + line("week")
    }

    func accountStatus(apiBase: String) async throws -> String {
        let data = try await checkedData(for: try jsonRequest(apiBase: apiBase, path: "/api/auth/me", method: "GET"))
        let json = (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        return "Profil: \(json["username"] as? String ?? "-") · Rol: \(json["role"] as? String ?? "-") · Vault: \(((json["vaultSalt"] as? String)?.isEmpty == false) ? "hazır" : "yok")"
    }
    func updateProfileUsername(apiBase: String, username: String) async throws -> String { var r = try jsonRequest(apiBase: apiBase, path: "/api/auth/profile", method: "PATCH"); r.httpBody = try JSONSerialization.data(withJSONObject: ["username": username]); _ = try await checkedData(for: r); return "Profil güncellendi." }
    func registerAccount(apiBase: String, username: String, password: String, email: String, inviteCode: String) async throws -> String { var r = try jsonRequest(apiBase: apiBase, path: "/api/auth/register", method: "POST"); r.httpBody = try JSONSerialization.data(withJSONObject: ["username": username, "password": password, "email": email, "inviteCode": inviteCode, "website": "", "recoveryVerifier": String(repeating: "0", count: 64)]); _ = try await checkedData(for: r); return "Kayıt isteği gönderildi." }
    func recoverVault(apiBase: String, username: String) async throws -> String { var r = try jsonRequest(apiBase: apiBase, path: "/api/auth/recover-vault", method: "POST"); r.httpBody = try JSONSerialization.data(withJSONObject: ["username": username]); return String(data: try await checkedData(for: r), encoding: .utf8) ?? "Kurtarma bilgisi alındı." }
    func resendVerification(apiBase: String, email: String) async throws -> String { var r = try jsonRequest(apiBase: apiBase, path: "/api/auth/resend-verification", method: "POST"); r.httpBody = try JSONSerialization.data(withJSONObject: ["email": email]); _ = try await checkedData(for: r); return "Doğrulama e-postası istendi." }
    func restoreAccount(apiBase: String, username: String, password: String) async throws -> String { var r = try jsonRequest(apiBase: apiBase, path: "/api/auth/restore-account", method: "POST"); r.httpBody = try JSONSerialization.data(withJSONObject: ["username": username, "password": password]); _ = try await checkedData(for: r); return "Hesap geri alındı." }
    func sendDmcaPlaceholder(apiBase: String) async throws -> String { var r = try jsonRequest(apiBase: apiBase, path: "/api/dmca", method: "POST"); r.httpBody = try JSONSerialization.data(withJSONObject: ["reporterName": "Native User", "reporterEmail": "native@example.com", "ownerName": "Native User", "infringingUrl": apiBase, "details": "Native DMCA form endpoint wired for personal client.", "signature": "Native User"]); _ = try await checkedData(for: r); return "DMCA endpoint hazır." }

    func syncStatus(apiBase: String) async throws -> String {
        #if os(iOS)
        let host = "iOS"
        #else
        let host = ProcessInfo.processInfo.hostName
        #endif
        let deviceID = "native-apple-\(host)".prefix(120)
        var register = try jsonRequest(apiBase: apiBase, path: "/api/sync/devices", method: "POST")
        register.httpBody = try JSONSerialization.data(withJSONObject: ["device_id": String(deviceID), "device_name": "Apple \(host)"])
        _ = try await checkedData(for: register)

        let devicesData = try await checkedData(for: try jsonRequest(apiBase: apiBase, path: "/api/sync/devices", method: "GET"))
        let devices = (try JSONSerialization.jsonObject(with: devicesData) as? [[String: Any]]) ?? []

        var components = URLComponents(url: try buildURL(apiBase: apiBase, path: "/api/sync/pull"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "device_id", value: String(deviceID))]
        guard let pullURL = components?.url else { throw NativeAPIError.invalidURL }
        let pullData = try await checkedData(for: URLRequest(url: pullURL))
        let pull = (try JSONSerialization.jsonObject(with: pullData) as? [String: Any]) ?? [:]
        let changes = (pull["changes"] as? [Any])?.count ?? 0
        let deleted = (pull["deleted"] as? [Any])?.count ?? 0
        let serverTime = pull["server_time"] as? String ?? "-"

        var push = try jsonRequest(apiBase: apiBase, path: "/api/sync/push", method: "POST")
        push.httpBody = try JSONSerialization.data(withJSONObject: ["device_id": String(deviceID), "changes": []])
        _ = try await checkedData(for: push)

        return "Senkron hazır. Cihaz: \(deviceID)\nKayıtlı cihaz: \(devices.count)\nÇekilen değişiklik: \(changes) · Silinen: \(deleted)\nSunucu zamanı: \(serverTime)"
    }

    func sendBugReport(apiBase: String, message: String, pageUrl: String) async throws {
        var request = try jsonRequest(apiBase: apiBase, path: "/api/bug-reports", method: "POST")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["message": message, "pageUrl": pageUrl])
        _ = try await checkedData(for: request)
    }

    func logout(apiBase: String) async throws {
        var request = try jsonRequest(apiBase: apiBase, path: "/api/auth/logout", method: "POST")
        request.httpBody = Data()
        _ = try? await checkedData(for: request)
    }

    func downloadFile(apiBase: String, path: String, filename: String) async throws -> URL {
        let url = try buildURL(apiBase: apiBase, path: path)
        let (tempURL, response) = try await session.download(from: url)
        try validate(response: response, body: "")
        let dir = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("PDFReaderNative", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let target = dir.appendingPathComponent(filename)
        if FileManager.default.fileExists(atPath: target.path) { try FileManager.default.removeItem(at: target) }
        try FileManager.default.moveItem(at: tempURL, to: target)
        return target
    }

    func downloadPDF(apiBase: String, book: Book, vaultKey: SymmetricKey?) async throws -> URL {
        let safeName = book.filename.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? book.filename
        let url = try buildURL(apiBase: apiBase, path: "/api/pdf/\(safeName)")
        let (tempURL, response) = try await session.download(from: url)
        try validate(response: response, body: "")
        let cacheDir = try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("PDFReaderNative", isDirectory: true)
        try FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
        let target = cacheDir.appendingPathComponent("\(book.id)-\(book.filename)")
        if FileManager.default.fileExists(atPath: target.path) { try FileManager.default.removeItem(at: target) }
        if book.isEncrypted {
            guard let vaultKey, let wrappedFek = book.wrapped_fek, !wrappedFek.isEmpty else { throw NativeAPIError.unsupported("Şifreli PDF için vault anahtarı yok.") }
            let fek = try NativeCrypto.unwrapWebKey(wrappedKeyHex: wrappedFek, wrappingKey: vaultKey)
            let encrypted = try Data(contentsOf: tempURL)
            let decrypted = try NativeCrypto.decryptUploadedFile(encrypted, fek: fek)
            try decrypted.write(to: target, options: .atomic)
            try? FileManager.default.removeItem(at: tempURL)
        } else {
            try FileManager.default.moveItem(at: tempURL, to: target)
        }
        return target
    }

    private func jsonRequest(apiBase: String, path: String, method: String) throws -> URLRequest {
        var request = URLRequest(url: try buildURL(apiBase: apiBase, path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return request
    }

    private func buildURL(apiBase: String, path: String) throws -> URL {
        guard var components = URLComponents(string: apiBase.trimmingCharacters(in: CharacterSet(charactersIn: "/"))) else { throw NativeAPIError.invalidURL }
        components.path = path
        guard let url = components.url else { throw NativeAPIError.invalidURL }
        return url
    }

    private func checkedData(for request: URLRequest) async throws -> Data {
        let (data, response) = try await session.data(for: request)
        let body = String(data: data, encoding: .utf8) ?? ""
        try validate(response: response, body: body)
        return data
    }

    private func validate(response: URLResponse, body: String) throws {
        guard let http = response as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else { throw NativeAPIError.badStatus(http.statusCode, body) }
    }
}
