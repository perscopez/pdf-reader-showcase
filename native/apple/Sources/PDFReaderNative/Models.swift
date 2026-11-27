import Foundation

struct LoginResponse: Codable {
    let success: Bool
    let user: NativeUser
}

struct NativeUser: Codable {
    let id: Int
    let username: String
    let role: String
    let is_test: Bool?
    let vaultSalt: String?
    let wrappedVaultKey: String?
}

struct Book: Codable, Identifiable, Hashable {
    let id: Int
    let title: String
    let author: String?
    let filename: String
    let filepath: String?
    let last_page: Int?
    let total_pages: Int?
    let favorite: Int?
    let category: String?
    let tags: String?
    let status: String?
    let is_encrypted: Int?
    let wrapped_fek: String?
    let encrypted_metadata: String?

    var displayAuthor: String { (author ?? "").isEmpty ? "Bilinmeyen yazar" : author! }
    var isEncrypted: Bool { (is_encrypted ?? 0) == 1 }
    var lastPage: Int { max(1, last_page ?? 1) }
}


struct SourceSearchResponse: Codable {
    let results: [SourceResult]
}

struct SourceResult: Codable, Identifiable, Hashable {
    var id: String { "\(source)-\(sourceId)" }
    let source: String
    let sourceId: String
    let title: String
    let author: String
    let description: String?
    let downloadUrl: String?
    let sourceUrl: String?
}


struct Bookmark: Codable, Identifiable, Hashable {
    let id: Int
    let book_id: Int
    let page: Int
    let label: String?

    var displayLabel: String {
        if let label, !label.isEmpty { return label }
        return "Sayfa \(page)"
    }
}


struct WordEntry: Codable, Identifiable, Hashable {
    let id: Int
    let word: String
    let definition: String?
    let context: String?
    let book_title: String?

    var displayDefinition: String { definition ?? "" }
}


struct AnnotationContent: Codable, Hashable {
    let note: String?
}

struct NoteAnnotation: Codable, Identifiable, Hashable {
    let id: Int
    let book_id: Int?
    let type: String
    let content: AnnotationContent
    let page: Int

    var displayNote: String { content.note ?? "" }
}


struct SearchResult: Codable, Identifiable, Hashable {
    let id: Int
    let bookId: Int
    let title: String
    let page: Int
    let text: String
}
