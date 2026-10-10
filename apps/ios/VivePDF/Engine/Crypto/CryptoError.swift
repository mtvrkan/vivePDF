import Foundation

/// Errors raised inside the crypto engine. `engineError` maps each case onto the desktop
/// `errors.reasons.<reason>` keys so screens can show the same messages as the desktop app.
enum CryptoError: LocalizedError, Equatable {
    /// Bytes that are not valid DER/BER or not the expected structure.
    case malformed(String)
    /// Valid structure, but an algorithm or feature this engine does not implement.
    case unsupported(String)
    /// The PKCS#12 password (or MAC) did not match.
    case wrongPassword
    /// A PKCS#12 file without a private key + certificate pair.
    case noPrivateKey
    /// A key file encrypted with a cipher that cannot be read (e.g. RC2 with odd effective bits).
    case legacyCipher
    /// A Security.framework / Keychain call failed.
    case security(OSStatus, String)
    /// Biometric / passcode prompt was dismissed.
    case authenticationCancelled
    /// The private key may not leave the device (Secure Enclave or non-exportable keychain item).
    case notExportable
    /// Network request (timestamp authority, breach range query) failed.
    case network(String)
    /// Caller-supplied parameter rejected; `reason` is a desktop `errors.reasons` key.
    case invalid(reason: String, detail: String? = nil)

    var engineError: EngineError {
        switch self {
        case .malformed(let detail): EngineError(.INVALID_PARAMS, reason: "certificateFormat", detail: detail)
        case .unsupported(let detail): EngineError(.UNSUPPORTED, detail: detail)
        case .wrongPassword: EngineError(.INVALID_PARAMS, reason: "certificatePassword")
        case .noPrivateKey: EngineError(.INVALID_PARAMS, reason: "keyFileFormat")
        case .legacyCipher: EngineError(.INVALID_PARAMS, reason: "certificateLegacy")
        case .security(let status, let detail): EngineError(.INTERNAL, detail: "\(detail) (\(status))")
        case .authenticationCancelled: .cancelled
        case .notExportable: EngineError(.PERMISSION_DENIED, detail: "private key is not exportable")
        case .network(let detail): EngineError(.NETWORK, reason: "timestamp", detail: detail)
        case .invalid(let reason, let detail): EngineError(.INVALID_PARAMS, reason: reason, detail: detail)
        }
    }

    var errorDescription: String? { engineError.errorDescription }
}

extension CryptoError {
    /// Any error as an `EngineError`, for callers that only surface `EngineError` to the UI.
    static func engineError(from error: Error) -> EngineError {
        if let engine = error as? EngineError { return engine }
        if let crypto = error as? CryptoError { return crypto.engineError }
        if error is CancellationError { return .cancelled }
        return .internalError(error.localizedDescription)
    }
}
