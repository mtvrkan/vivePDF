import Foundation
import Security

/// Result of verifying one CMS signature (fields mirror the desktop `SignatureInfo` where they apply).
struct CMSVerificationResult: Sendable {
    enum Status: String, Sendable {
        /// Intact, mathematically valid, trusted chain, certificate valid at signing time.
        case valid
        /// The signed bytes changed (message digest mismatch).
        case modified
        /// Signature value does not verify, or the CMS could not be processed.
        case invalid
        /// Valid signature from a signer that does not chain to a trusted root.
        case unknownSigner
        /// Signer certificate expired / not yet valid at the (trusted) signing time.
        case expired
        /// Signer certificate revoked (online check only).
        case revoked
        /// Trusted, but revocation could not be determined while checking online.
        case revocationUnknown
    }

    var status: Status = .invalid
    var signer: X509Certificate?
    /// Certificates embedded in the CMS.
    var embeddedCertificates: [X509Certificate] = []
    /// Chain used for the trust decision, leaf first.
    var chain: [X509Certificate] = []
    var signerName: String = "?"
    var digestAlgorithm: DigestAlgorithm?
    var signatureAlgorithm: SignatureAlgorithm?
    /// Message digest attribute (or eContent) matches the signed bytes.
    var intact = false
    /// The signature value verifies with the signer's key.
    var signatureValid = false
    var trusted = false
    var trustSource = "none"
    var trustProblem: String?
    var revoked: Bool?
    /// signing-time attribute (claimed by the signer).
    var claimedSigningTime: Date?
    var timestamp: TimestampInfo?
    /// CAdES (signing-certificate-v2 present) vs plain PKCS#7.
    var isCAdES = false
    /// Signing-certificate attribute present but does not match the signer certificate.
    var signingCertificateMismatch = false
    var failure: String?

    /// `valid` in the desktop sense: intact and cryptographically sound.
    var valid: Bool { intact && signatureValid }

    /// Best signing time: the timestamp's when present, else the claimed time.
    var signedAt: Date? { timestamp?.valid == true ? timestamp?.time : claimedSigningTime }

    var summary: String {
        var parts = [status.rawValue]
        if let problem = trustProblem { parts.append(problem) }
        if let failure { parts.append(failure) }
        return parts.joined(separator: ", ")
    }
}

/// Verifies CMS SignedData signatures (PDF adbe.pkcs7.detached / ETSI.CAdES.detached / adbe.pkcs7.sha1).
enum CMSVerifier {
    /// Verifies a detached signature over the concatenation of `content` (e.g. PDF ByteRange slices).
    static func verify(cms: Data, content: [Data], trust: TrustEvaluator = TrustEvaluator(), now: Date = Date()) -> CMSVerificationResult {
        verify(cms: cms, contentDigest: { $0.hash(content) }, trust: trust, now: now)
    }

    /// Verifies the PDF-style ByteRange `[a b c d]` slices of `fileData`.
    static func verify(cms: Data, fileData: Data, byteRange: ByteRange, trust: TrustEvaluator = TrustEvaluator(), now: Date = Date()) -> CMSVerificationResult {
        verify(cms: cms, contentDigest: { $0.hash(byteRange.slices(of: fileData)) }, trust: trust, now: now)
    }

    /// Verifies with a digest provider (called with the signer's digest algorithm), so large files can be
    /// hashed by streaming.
    static func verify(cms: Data, contentDigest: (DigestAlgorithm) throws -> Data, trust: TrustEvaluator = TrustEvaluator(), now: Date = Date()) -> CMSVerificationResult {
        var result = CMSVerificationResult()
        let signedData: CMSSignedData
        do { signedData = try CMSSignedData(der: cms) } catch {
            result.failure = "unreadable CMS: \(error.localizedDescription)"
            return result
        }
        result.embeddedCertificates = signedData.certificates
        guard let signer = signedData.signerInfos.first else {
            result.failure = "no signer"
            return result
        }
        let check = checkSignerInfo(signer, in: signedData, contentDigest: contentDigest)
        result.signer = check.certificate
        result.signerName = check.certificate?.label ?? "?"
        result.digestAlgorithm = signer.digestAlgorithm
        result.signatureAlgorithm = check.algorithm
        result.intact = check.intact
        result.signatureValid = check.signatureValid
        result.failure = check.failure
        result.claimedSigningTime = signer.signingTime
        result.isCAdES = signer.signedAttribute(OID.signingCertificateV2) != nil
        if let reference = signer.signingCertificateReference, let certificate = check.certificate,
           reference.digest.hash(certificate.der) != reference.hash {
            result.signingCertificateMismatch = true
            result.signatureValid = false
            result.failure = "signing certificate attribute does not match"
        }
        if let token = signer.timestampToken {
            result.timestamp = TimestampClient.verifyToken(token, timestampedData: signer.signature, trust: trust)
        }
        guard let certificate = check.certificate else {
            result.trustProblem = "noChain"
            result.status = result.intact ? .invalid : .modified
            return result
        }

        // Trust: evaluate at the timestamp time when there is one (proof of existence), else now.
        let evaluationTime = result.timestamp?.valid == true ? result.timestamp!.time : now
        let outcome = trust.evaluate(certificate, intermediates: signedData.certificates, at: evaluationTime)
        result.chain = outcome.chain
        result.trusted = outcome.trusted
        result.trustSource = outcome.trusted ? outcome.source : "none"
        result.trustProblem = outcome.problem
        result.revoked = outcome.revoked
        if outcome.trusted {
            if !certificate.allowsDocumentSigning {
                result.trusted = false
                result.trustProblem = "notForSigning"
            } else if let digest = check.algorithm?.digest, digest == .sha1 {
                result.trusted = false
                result.trustProblem = "weakAlgorithm"
            }
        }
        if result.trustProblem == nil, !certificate.isValid(at: evaluationTime) {
            result.trusted = false
            result.trustProblem = evaluationTime < certificate.notBefore ? "notYetValid" : "expired"
        }
        if let claimed = result.claimedSigningTime, result.timestamp == nil, !certificate.isValid(at: claimed), result.trustProblem == nil {
            result.trustProblem = claimed < certificate.notBefore ? "notYetValid" : "expired"
            result.trusted = false
        }

        result.status = status(for: result)
        return result
    }

    static func status(for result: CMSVerificationResult) -> CMSVerificationResult.Status {
        if !result.intact { return .modified }
        if !result.signatureValid { return .invalid }
        if result.revoked == true || result.trustProblem == "revoked" { return .revoked }
        if result.trustProblem == "expired" || result.trustProblem == "notYetValid" { return .expired }
        if !result.trusted { return .unknownSigner }
        if result.trustProblem == "revocationUnknown" { return .revocationUnknown }
        return .valid
    }

    struct SignerCheck {
        var certificate: X509Certificate?
        var algorithm: SignatureAlgorithm?
        var intact = false
        var signatureValid = false
        var failure: String?
    }

    /// Message digest + signature check for one SignerInfo (shared with timestamp tokens).
    static func checkSignerInfo(_ signer: CMSSignedData.SignerInfo, in signedData: CMSSignedData,
                                contentDigest: (DigestAlgorithm) throws -> Data) -> SignerCheck {
        var check = SignerCheck()
        check.certificate = signer.findCertificate(in: signedData.certificates)
        guard let digest = signer.digestAlgorithm else {
            check.failure = "unsupported digest \(OID.name(signer.digestAlgorithmOID))"
            return check
        }
        do {
            check.algorithm = try SignatureAlgorithm(identifier: signer.signatureAlgorithmIdentifier, digestHint: digest)
        } catch {
            check.failure = error.localizedDescription
        }
        // adbe.pkcs7.sha1: the eContent is the SHA-1 of the signed bytes and the signature covers it.
        let contentHash: Data
        do {
            if let embedded = signedData.encapsulatedContent, signedData.encapsulatedContentType == OID.data {
                contentHash = digest.hash(embedded)
                // Either adbe.pkcs7.sha1 (eContent = SHA-1 of the bytes) or an attached copy of the bytes.
                let sha1 = try contentDigest(.sha1)
                let full = try contentDigest(digest)
                check.intact = embedded == sha1 || contentHash == full
            } else {
                contentHash = try contentDigest(digest)
                check.intact = true
            }
        } catch {
            check.failure = "content unavailable: \(error.localizedDescription)"
            return check
        }
        let signedBytesDigest: Data
        if let attributes = signer.signedAttributesDER {
            check.intact = check.intact && signer.messageDigest == contentHash
            signedBytesDigest = digest.hash(attributes)
        } else {
            signedBytesDigest = contentHash
        }
        guard let certificate = check.certificate else {
            check.failure = check.failure ?? "signer certificate not included"
            return check
        }
        guard let algorithm = check.algorithm, let key = try? certificate.publicKey.secKey() else { return check }
        // A signature algorithm that implies a different hash than the SignerInfo's digest algorithm is
        // re-hashed with that one (seen in the wild for sha1WithRSA + SHA-256 digest).
        var verifyDigest = signedBytesDigest
        if algorithm.digest != digest {
            if let attributes = signer.signedAttributesDER { verifyDigest = algorithm.digest.hash(attributes) }
            else if let rehashed = try? contentDigest(algorithm.digest) { verifyDigest = rehashed }
        }
        check.signatureValid = algorithm.verify(signature: signer.signature, digest: verifyDigest, publicKey: key)
        // Without signed attributes the signature covers the content directly, so a failure cannot be
        // told apart from a content change; report it as modified, as pyHanko does.
        if signer.signedAttributesDER == nil && signedData.encapsulatedContent == nil { check.intact = check.signatureValid }
        return check
    }

    /// Legacy `adbe.x509.rsa_sha1`: /Contents holds a PKCS#1 signature (OCTET STRING-wrapped) over the
    /// SHA-1 of the ByteRange, and /Cert the certificate(s).
    static func verifyRSASHA1(signature: Data, certificate: X509Certificate, content: [Data]) -> Bool {
        let raw = (try? ASN1.parse(signature).octets) ?? signature
        guard let key = try? certificate.publicKey.secKey() else { return false }
        let algorithm = SignatureAlgorithm(kind: .rsaPKCS1, digest: .sha1)
        return algorithm.verify(signature: raw, digest: DigestAlgorithm.sha1.hash(content), publicKey: key)
    }
}

/// A PDF signature ByteRange `[start1 length1 start2 length2]` and the coverage checks pyHanko reports.
struct ByteRange: Equatable, Sendable {
    /// pyHanko `SignatureCoverageLevel` names, as the desktop reports them.
    enum Coverage: String, Sendable {
        case unclear = "UNCLEAR"
        case contiguousBlockFromStart = "CONTIGUOUS_BLOCK_FROM_START"
        case entireRevision = "ENTIRE_REVISION"
        case entireFile = "ENTIRE_FILE"
    }

    let ranges: [(offset: Int, length: Int)]

    init?(_ values: [Int]) {
        guard values.count >= 2, values.count % 2 == 0, values.allSatisfy({ $0 >= 0 }) else { return nil }
        ranges = stride(from: 0, to: values.count, by: 2).map { (values[$0], values[$0 + 1]) }
    }

    static func == (lhs: ByteRange, rhs: ByteRange) -> Bool {
        lhs.ranges.map(\.offset) == rhs.ranges.map(\.offset) && lhs.ranges.map(\.length) == rhs.ranges.map(\.length)
    }

    /// End of the signed revision (last byte covered + 1).
    var signedEnd: Int { ranges.last.map { $0.offset + $0.length } ?? 0 }

    /// The excluded gap holding `/Contents <…>` (including the angle brackets), for two-range signatures.
    var contentsGap: Range<Int>? {
        guard ranges.count == 2 else { return nil }
        let start = ranges[0].offset + ranges[0].length
        return start < ranges[1].offset ? start..<ranges[1].offset : nil
    }

    /// The signed slices of a file (empty when the range does not fit).
    func slices(of data: Data) -> [Data] {
        ranges.compactMap { range in
            let lower = data.startIndex + range.offset
            let upper = lower + range.length
            return upper <= data.endIndex ? data.subdata(in: lower..<upper) : nil
        }
    }

    /// Raw CMS bytes decoded from the hex `/Contents` string in the gap.
    func contents(in data: Data) -> Data? {
        guard let gap = contentsGap, gap.upperBound <= data.count else { return nil }
        var bytes = data.subdata(in: (data.startIndex + gap.lowerBound)..<(data.startIndex + gap.upperBound))
        if bytes.first == UInt8(ascii: "<") { bytes = bytes.dropFirst().cryptoDetached }
        if bytes.last == UInt8(ascii: ">") { bytes = bytes.dropLast().cryptoDetached }
        guard let text = String(data: bytes, encoding: .ascii), var decoded = Data(cryptoHex: text) else { return nil }
        // Strip the zero padding of the placeholder past the DER element.
        if let node = try? ASN1.parse(decoded) { decoded = node.raw }
        return decoded
    }

    /// Coverage relative to the whole file. `revisionEnds` are the byte offsets just past each `%%EOF`
    /// (from PDFCore); when given, a range that stops exactly at one is `entireRevision`.
    func coverage(fileLength: Int, revisionEnds: [Int] = []) -> Coverage {
        guard let first = ranges.first, first.offset == 0 else { return .unclear }
        // Exactly one gap, and it must only hold the /Contents string.
        guard ranges.count == 2, contentsGap != nil else {
            return ranges.count == 1 ? (first.length == fileLength ? .entireFile : .contiguousBlockFromStart) : .unclear
        }
        let end = signedEnd
        if end > fileLength { return .unclear }
        if end == fileLength { return .entireFile }
        if revisionEnds.isEmpty || revisionEnds.contains(where: { abs($0 - end) <= 2 }) { return .entireRevision }
        return .contiguousBlockFromStart
    }

    /// Bytes were appended after the signed revision (incremental updates): the document may have
    /// been modified after signing; PDF-level diff analysis decides whether the changes are allowed.
    func hasLaterChanges(fileLength: Int) -> Bool { signedEnd < fileLength }
}
