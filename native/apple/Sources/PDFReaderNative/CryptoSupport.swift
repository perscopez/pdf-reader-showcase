import Foundation
import CryptoKit
import CommonCrypto

enum NativeCryptoError: LocalizedError {
    case invalidHex
    case pbkdfFailed
    case decryptFailed

    var errorDescription: String? {
        switch self {
        case .invalidHex: return "Şifreli veri formatı okunamadı."
        case .pbkdfFailed: return "Anahtar türetilemedi."
        case .decryptFailed: return "PDF şifresi çözülemedi."
        }
    }
}

enum NativeCrypto {
    static func hexToData(_ hex: String) throws -> Data {
        let clean = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        guard clean.count % 2 == 0 else { throw NativeCryptoError.invalidHex }
        var data = Data(capacity: clean.count / 2)
        var index = clean.startIndex
        while index < clean.endIndex {
            let next = clean.index(index, offsetBy: 2)
            guard let byte = UInt8(clean[index..<next], radix: 16) else { throw NativeCryptoError.invalidHex }
            data.append(byte)
            index = next
        }
        return data
    }

    static func derivePasswordKey(password: String, saltHex: String) throws -> SymmetricKey {
        let passwordData = Data(password.utf8)
        let salt = try hexToData(saltHex)
        var derived = Data(count: 32)
        let derivedCount = derived.count
        let status = derived.withUnsafeMutableBytes { derivedBytes in
            passwordData.withUnsafeBytes { passwordBytes in
                salt.withUnsafeBytes { saltBytes in
                    CCKeyDerivationPBKDF(
                        CCPBKDFAlgorithm(kCCPBKDF2),
                        passwordBytes.bindMemory(to: Int8.self).baseAddress,
                        passwordData.count,
                        saltBytes.bindMemory(to: UInt8.self).baseAddress,
                        salt.count,
                        CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                        100_000,
                        derivedBytes.bindMemory(to: UInt8.self).baseAddress,
                        derivedCount
                    )
                }
            }
        }
        guard status == kCCSuccess else { throw NativeCryptoError.pbkdfFailed }
        return SymmetricKey(data: derived)
    }

    static func decryptWebAesGcm(cipherAndTag: Data, iv: Data, key: SymmetricKey) throws -> Data {
        guard cipherAndTag.count >= 16 else { throw NativeCryptoError.decryptFailed }
        let cipher = cipherAndTag.prefix(cipherAndTag.count - 16)
        let tag = cipherAndTag.suffix(16)
        let nonce = try AES.GCM.Nonce(data: iv)
        let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: cipher, tag: tag)
        return try AES.GCM.open(box, using: key)
    }

    static func unwrapWebKey(wrappedKeyHex: String, wrappingKey: SymmetricKey) throws -> SymmetricKey {
        let wrapped = try hexToData(wrappedKeyHex)
        let raw = try decryptWebAesGcm(cipherAndTag: wrapped, iv: Data(repeating: 0, count: 12), key: wrappingKey)
        return SymmetricKey(data: raw)
    }

    static func decryptUploadedFile(_ encryptedBytes: Data, fek: SymmetricKey) throws -> Data {
        guard encryptedBytes.count > 12 else { throw NativeCryptoError.decryptFailed }
        let iv = encryptedBytes.prefix(12)
        let cipherAndTag = encryptedBytes.dropFirst(12)
        return try decryptWebAesGcm(cipherAndTag: Data(cipherAndTag), iv: Data(iv), key: fek)
    }
}
