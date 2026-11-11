import CommonCrypto
import CryptoKit
import Foundation

/// A scenario the user explicitly chose to save: one calculator's inputs, nothing else.
/// No names, account numbers or identifiers are part of the format.
public struct ScenarioFile: Codable, Equatable {
    public var format = "wealthdesk-scenario"
    public var version = 1
    public var calculatorID: String
    public var title: String
    public var inputs: [String: String]
    public var saved: Date

    public init(calculatorID: String, title: String, inputs: [String: String], saved: Date = Date()) {
        self.calculatorID = calculatorID
        self.title = title
        self.inputs = inputs
        self.saved = saved
    }

    struct Sealed: Codable {
        var format = "wealthdesk-scenario-encrypted"
        var version = 1
        var kdf = "PBKDF2-HMAC-SHA256"
        var iterations: Int
        var salt: Data
        var box: Data      // AES-256-GCM: nonce + ciphertext + tag
    }

    static let iterations = 310_000

    static var encoder: JSONEncoder {
        let e = JSONEncoder()
        e.outputFormatting = [.prettyPrinted, .sortedKeys]
        e.dateEncodingStrategy = .iso8601
        return e
    }

    static var decoder: JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }

    static func key(password: String, salt: Data, iterations: Int) throws -> SymmetricKey {
        var out = [UInt8](repeating: 0, count: 32)
        let pw = Array(password.utf8)
        let status = salt.withUnsafeBytes { saltBytes in
            CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), pw.map { Int8(bitPattern: $0) }, pw.count,
                                 saltBytes.bindMemory(to: UInt8.self).baseAddress, salt.count,
                                 CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), UInt32(iterations), &out, out.count)
        }
        guard status == kCCSuccess else { throw EvalError.message("Couldn't derive the encryption key.") }
        return SymmetricKey(data: Data(out))
    }

    /// File contents. With a password the scenario is encrypted (AES-256-GCM, PBKDF2 key).
    public func data(password: String? = nil) throws -> Data {
        let plain = try Self.encoder.encode(self)
        guard let password, !password.isEmpty else { return plain }
        var salt = Data(count: 16)
        let ok = salt.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 16, $0.baseAddress!) }
        guard ok == errSecSuccess else { throw EvalError.message("Couldn't generate a random salt.") }
        let key = try Self.key(password: password, salt: salt, iterations: Self.iterations)
        guard let box = try AES.GCM.seal(plain, using: key).combined else { throw EvalError.message("Encryption failed.") }
        return try Self.encoder.encode(Sealed(iterations: Self.iterations, salt: salt, box: box))
    }

    public static func isEncrypted(_ data: Data) -> Bool {
        (try? decoder.decode(Sealed.self, from: data))?.format == "wealthdesk-scenario-encrypted"
    }

    public static func read(_ data: Data, password: String? = nil) throws -> ScenarioFile {
        if let sealed = try? decoder.decode(Sealed.self, from: data), sealed.format == "wealthdesk-scenario-encrypted" {
            guard let password, !password.isEmpty else { throw EvalError.message("This scenario file is password-protected.") }
            let key = try key(password: password, salt: sealed.salt, iterations: sealed.iterations)
            guard let box = try? AES.GCM.SealedBox(combined: sealed.box), let plain = try? AES.GCM.open(box, using: key) else {
                throw EvalError.message("Wrong password, or the file is damaged.")
            }
            return try decoder.decode(ScenarioFile.self, from: plain)
        }
        guard let s = try? decoder.decode(ScenarioFile.self, from: data), s.format == "wealthdesk-scenario" else {
            throw EvalError.message("That isn't a Wealth Desk scenario file.")
        }
        return s
    }
}
