import Foundation

/// An RFC 3161 time-stamping authority.
struct TimestampAuthority: Sendable, Hashable {
    var url: URL
    var username: String?
    var password: String?
    /// Hash sent in the message imprint.
    var digest: DigestAlgorithm = .sha256
    var policyOID: String?
    var timeout: TimeInterval = 20

    init(url: URL, username: String? = nil, password: String? = nil, digest: DigestAlgorithm = .sha256) {
        self.url = url
        self.username = username
        self.password = password
        self.digest = digest
    }

    /// Validates a user-typed address like the desktop `_check_timestamp_url` (http/https with a host).
    /// Returns nil for empty input; throws `timestampUrl` for anything else that is not usable.
    static func parse(_ text: String) throws -> TimestampAuthority? {
        let cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.isEmpty { return nil }
        guard let url = URL(string: cleaned), let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme),
              let host = url.host, !host.isEmpty else { throw CryptoError.invalid(reason: "timestampUrl") }
        return TimestampAuthority(url: url)
    }

    /// Plain-HTTP servers work but the desktop warns about them.
    var isInsecure: Bool { url.scheme?.lowercased() == "http" }
}

/// Decoded TSTInfo plus verification results.
struct TimestampInfo: Sendable {
    var time: Date
    var serialNumber: Data
    var policy: String
    var imprintDigest: DigestAlgorithm?
    var imprint: Data
    var nonce: Data?
    var authority: X509Certificate?
    /// TSA name for display (certificate CN, else the TSTInfo `tsa` field).
    var authorityName: String?
    /// Imprint matches the timestamped bytes.
    var intact = false
    /// The token's CMS signature verifies.
    var signatureValid = false
    /// The TSA chain is trusted (system or user roots).
    var trusted = false

    var valid: Bool { intact && signatureValid }
}

/// RFC 3161 client and token parser.
enum TimestampClient {
    /// Timestamps `data` (for CMS signature timestamps: the SignerInfo signature value) and returns the
    /// TimeStampToken (ContentInfo DER).
    static func requestToken(for data: Data, authority: TimestampAuthority) async throws -> Data {
        try await requestToken(imprint: authority.digest.hash(data), authority: authority)
    }

    /// Requests a token for an already computed imprint (PDF document timestamps hash the ByteRange).
    static func requestToken(imprint: Data, authority: TimestampAuthority) async throws -> Data {
        let nonce = KeyDerivation.randomBytes(8)
        var fields: [ASN1Node] = [
            ASN1.integer(1),
            ASN1.sequence([ASN1.algorithm(authority.digest.oid, ASN1.null()), ASN1.octetString(imprint)]),
        ]
        if let policy = authority.policyOID { fields.append(ASN1.oid(policy)) }
        fields.append(ASN1.integer(unsigned: nonce))
        fields.append(ASN1.boolean(true))
        let body = ASN1.sequence(fields).raw

        var request = URLRequest(url: authority.url, timeoutInterval: authority.timeout)
        request.httpMethod = "POST"
        request.httpBody = body
        request.setValue("application/timestamp-query", forHTTPHeaderField: "Content-Type")
        request.setValue("application/timestamp-reply", forHTTPHeaderField: "Accept")
        if let username = authority.username {
            let credentials = Data("\(username):\(authority.password ?? "")".utf8).base64EncodedString()
            request.setValue("Basic \(credentials)", forHTTPHeaderField: "Authorization")
        }
        let responseData: Data
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw CryptoError.network("timestamp server answered \((response as? HTTPURLResponse)?.statusCode ?? -1)")
            }
            responseData = data
        } catch let error as CryptoError {
            throw error
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            if (error as? URLError)?.code == .cancelled { throw CancellationError() }
            throw CryptoError.network(error.localizedDescription)
        }
        let token = try parseResponse(responseData)
        let info = try parseToken(token)
        guard info.imprint == imprint, info.nonce.map({ SignerInfoMatch.sameInteger($0, nonce) }) ?? true else {
            throw CryptoError.network("timestamp response does not match the request")
        }
        return token
    }

    /// Extracts the token from a TimeStampResp, throwing when the status is not granted.
    static func parseResponse(_ data: Data) throws -> Data {
        let response: ASN1Node
        do { response = try ASN1.parse(data) } catch { throw CryptoError.network("not a timestamp response") }
        let status = try response[0][0].intValue
        guard status == 0 || status == 1, response.children.count > 1 else {
            let text = (try? response[0][1].children.compactMap { try? $0.stringValue }.joined(separator: "; ")) ?? ""
            throw CryptoError.network("timestamp refused (status \(status)) \(text)")
        }
        return try response[1].raw
    }

    /// Decodes the TSTInfo of a token (no signature check; see `verifyToken`).
    static func parseToken(_ token: Data) throws -> TimestampInfo {
        let signedData = try CMSSignedData(der: token)
        guard signedData.encapsulatedContentType == OID.tstInfo, let content = signedData.encapsulatedContent else {
            throw CryptoError.malformed("not a timestamp token")
        }
        let tst = try ASN1.parse(content)
        let imprint = try tst[2]
        var info = TimestampInfo(time: try tst[4].dateValue, serialNumber: try tst[3].integerBytes, policy: try tst[1].oid,
                                 imprintDigest: DigestAlgorithm(oid: try imprint[0][0].oid), imprint: try imprint[1].octets)
        for field in tst.children.dropFirst(5) {
            if field.isUniversal(ASN1Node.Universal.integer) { info.nonce = try field.integerBytes }
            if field.isContext(0), let name = field.children.first, name.isContext(4), let dn = name.children.first {
                info.authorityName = (try? DistinguishedName(node: dn))?.label
            }
        }
        if let signer = signedData.signerInfos.first, let certificate = signer.findCertificate(in: signedData.certificates) {
            info.authority = certificate
            info.authorityName = certificate.label
        }
        return info
    }

    /// Parses and verifies a token against the bytes it should cover (for a signature timestamp:
    /// the signature value). Trust is evaluated with `trust` (nil skips the chain check).
    static func verifyToken(_ token: Data, timestampedData: Data, trust: TrustEvaluator? = nil) -> TimestampInfo? {
        guard var info = try? parseToken(token), let signedData = try? CMSSignedData(der: token),
              let signer = signedData.signerInfos.first, let content = signedData.encapsulatedContent else { return nil }
        if let digest = info.imprintDigest { info.intact = digest.hash(timestampedData) == info.imprint }
        let check = CMSVerifier.checkSignerInfo(signer, in: signedData, contentDigest: { $0.hash(content) })
        info.signatureValid = check.intact && check.signatureValid
        if let certificate = check.certificate, let trust {
            let outcome = trust.evaluate(certificate, intermediates: signedData.certificates, at: info.time)
            info.trusted = outcome.trusted
        }
        return info
    }
}

/// Integer comparison that ignores sign-padding octets.
enum SignerInfoMatch {
    static func sameInteger(_ a: Data, _ b: Data) -> Bool { CMSSignedData.SignerInfo.sameSerial(a, b) }
}
