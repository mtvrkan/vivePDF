import Foundation

/// Object identifiers used by the crypto engine (dotted strings so they can be compared directly).
enum OID {
    // Digests
    static let md5 = "1.2.840.113549.2.5"
    static let sha1 = "1.3.14.3.2.26"
    static let sha224 = "2.16.840.1.101.3.4.2.4"
    static let sha256 = "2.16.840.1.101.3.4.2.1"
    static let sha384 = "2.16.840.1.101.3.4.2.2"
    static let sha512 = "2.16.840.1.101.3.4.2.3"

    // Public keys and signatures
    static let rsaEncryption = "1.2.840.113549.1.1.1"
    static let md5WithRSA = "1.2.840.113549.1.1.4"
    static let sha1WithRSA = "1.2.840.113549.1.1.5"
    static let rsaesOAEP = "1.2.840.113549.1.1.7"
    static let mgf1 = "1.2.840.113549.1.1.8"
    static let rsassaPSS = "1.2.840.113549.1.1.10"
    static let sha256WithRSA = "1.2.840.113549.1.1.11"
    static let sha384WithRSA = "1.2.840.113549.1.1.12"
    static let sha512WithRSA = "1.2.840.113549.1.1.13"
    static let sha224WithRSA = "1.2.840.113549.1.1.14"
    static let ecPublicKey = "1.2.840.10045.2.1"
    static let ecdsaWithSHA1 = "1.2.840.10045.4.1"
    static let ecdsaWithSHA224 = "1.2.840.10045.4.3.1"
    static let ecdsaWithSHA256 = "1.2.840.10045.4.3.2"
    static let ecdsaWithSHA384 = "1.2.840.10045.4.3.3"
    static let ecdsaWithSHA512 = "1.2.840.10045.4.3.4"
    static let ed25519 = "1.3.101.112"
    static let dsa = "1.2.840.10040.4.1"

    // Curves
    static let p256 = "1.2.840.10045.3.1.7"
    static let p384 = "1.3.132.0.34"
    static let p521 = "1.3.132.0.35"

    // Symmetric ciphers / PBE
    static let aes128CBC = "2.16.840.1.101.3.4.1.2"
    static let aes192CBC = "2.16.840.1.101.3.4.1.22"
    static let aes256CBC = "2.16.840.1.101.3.4.1.42"
    static let desEDE3CBC = "1.2.840.113549.3.7"
    static let desCBC = "1.3.14.3.2.7"
    static let rc2CBC = "1.2.840.113549.3.2"
    static let rc4 = "1.2.840.113549.3.4"
    static let pbes2 = "1.2.840.113549.1.5.13"
    static let pbkdf2 = "1.2.840.113549.1.5.12"
    static let hmacWithSHA1 = "1.2.840.113549.2.7"
    static let hmacWithSHA224 = "1.2.840.113549.2.8"
    static let hmacWithSHA256 = "1.2.840.113549.2.9"
    static let hmacWithSHA384 = "1.2.840.113549.2.10"
    static let hmacWithSHA512 = "1.2.840.113549.2.11"
    static let pbeSHA1RC4_128 = "1.2.840.113549.1.12.1.1"
    static let pbeSHA1RC4_40 = "1.2.840.113549.1.12.1.2"
    static let pbeSHA1TripleDES = "1.2.840.113549.1.12.1.3"
    static let pbeSHA1TwoKeyTripleDES = "1.2.840.113549.1.12.1.4"
    static let pbeSHA1RC2_128 = "1.2.840.113549.1.12.1.5"
    static let pbeSHA1RC2_40 = "1.2.840.113549.1.12.1.6"

    // PKCS#7 / CMS content types
    static let data = "1.2.840.113549.1.7.1"
    static let signedData = "1.2.840.113549.1.7.2"
    static let envelopedData = "1.2.840.113549.1.7.3"
    static let encryptedData = "1.2.840.113549.1.7.6"
    static let tstInfo = "1.2.840.113549.1.9.16.1.4"

    // CMS attributes
    static let contentType = "1.2.840.113549.1.9.3"
    static let messageDigest = "1.2.840.113549.1.9.4"
    static let signingTime = "1.2.840.113549.1.9.5"
    static let counterSignature = "1.2.840.113549.1.9.6"
    static let signingCertificate = "1.2.840.113549.1.9.16.2.12"
    static let signingCertificateV2 = "1.2.840.113549.1.9.16.2.47"
    static let timeStampToken = "1.2.840.113549.1.9.16.2.14"
    static let cmsAlgorithmProtection = "1.2.840.113549.1.9.52"
    static let adobeRevocationInfo = "1.2.840.113583.1.1.8"

    // PKCS#9 / PKCS#12
    static let friendlyName = "1.2.840.113549.1.9.20"
    static let localKeyID = "1.2.840.113549.1.9.21"
    static let x509CertificateBag = "1.2.840.113549.1.9.22.1"
    static let keyBag = "1.2.840.113549.1.12.10.1.1"
    static let pkcs8ShroudedKeyBag = "1.2.840.113549.1.12.10.1.2"
    static let certBag = "1.2.840.113549.1.12.10.1.3"
    static let crlBag = "1.2.840.113549.1.12.10.1.4"
    static let secretBag = "1.2.840.113549.1.12.10.1.5"
    static let safeContentsBag = "1.2.840.113549.1.12.10.1.6"
    static let pbmac1 = "1.2.840.113549.1.5.14"

    // Name attributes
    static let commonName = "2.5.4.3"
    static let surname = "2.5.4.4"
    static let serialNumber = "2.5.4.5"
    static let countryName = "2.5.4.6"
    static let localityName = "2.5.4.7"
    static let stateOrProvinceName = "2.5.4.8"
    static let streetAddress = "2.5.4.9"
    static let organizationName = "2.5.4.10"
    static let organizationalUnitName = "2.5.4.11"
    static let title = "2.5.4.12"
    static let postalCode = "2.5.4.17"
    static let givenName = "2.5.4.42"
    static let initials = "2.5.4.43"
    static let pseudonym = "2.5.4.65"
    static let organizationIdentifier = "2.5.4.97"
    static let emailAddress = "1.2.840.113549.1.9.1"
    static let domainComponent = "0.9.2342.19200300.100.1.25"
    static let userID = "0.9.2342.19200300.100.1.1"

    // Extensions
    static let subjectKeyIdentifier = "2.5.29.14"
    static let keyUsage = "2.5.29.15"
    static let subjectAltName = "2.5.29.17"
    static let issuerAltName = "2.5.29.18"
    static let basicConstraints = "2.5.29.19"
    static let crlDistributionPoints = "2.5.29.31"
    static let certificatePolicies = "2.5.29.32"
    static let authorityKeyIdentifier = "2.5.29.35"
    static let extendedKeyUsage = "2.5.29.37"
    static let authorityInfoAccess = "1.3.6.1.5.5.7.1.1"
    static let qcStatements = "1.3.6.1.5.5.7.1.3"
    static let ocspNoCheck = "1.3.6.1.5.5.7.48.1.5"
    static let accessOCSP = "1.3.6.1.5.5.7.48.1"
    static let accessCAIssuers = "1.3.6.1.5.5.7.48.2"

    // Extended key usages
    static let ekuServerAuth = "1.3.6.1.5.5.7.3.1"
    static let ekuClientAuth = "1.3.6.1.5.5.7.3.2"
    static let ekuCodeSigning = "1.3.6.1.5.5.7.3.3"
    static let ekuEmailProtection = "1.3.6.1.5.5.7.3.4"
    static let ekuTimeStamping = "1.3.6.1.5.5.7.3.8"
    static let ekuOCSPSigning = "1.3.6.1.5.5.7.3.9"
    static let ekuDocumentSigning = "1.3.6.1.5.5.7.3.36"
    static let ekuAdobeAuthenticDocuments = "1.2.840.113583.1.1.5"
    static let ekuAny = "2.5.29.37.0"

    /// Readable short names for display (attribute keys follow RFC 4514 / OpenSSL).
    static let names: [String: String] = [
        commonName: "CN", surname: "SN", serialNumber: "serialNumber", countryName: "C", localityName: "L",
        stateOrProvinceName: "ST", streetAddress: "street", organizationName: "O", organizationalUnitName: "OU",
        title: "title", postalCode: "postalCode", givenName: "GN", initials: "initials", pseudonym: "pseudonym",
        organizationIdentifier: "organizationIdentifier", emailAddress: "E", domainComponent: "DC", userID: "UID",
        sha1: "SHA-1", sha224: "SHA-224", sha256: "SHA-256", sha384: "SHA-384", sha512: "SHA-512", md5: "MD5",
        rsaEncryption: "RSA", rsassaPSS: "RSASSA-PSS", ecPublicKey: "EC", ed25519: "Ed25519", dsa: "DSA",
        sha1WithRSA: "SHA-1 with RSA", sha256WithRSA: "SHA-256 with RSA", sha384WithRSA: "SHA-384 with RSA",
        sha512WithRSA: "SHA-512 with RSA", ecdsaWithSHA256: "ECDSA with SHA-256", ecdsaWithSHA384: "ECDSA with SHA-384",
        ecdsaWithSHA512: "ECDSA with SHA-512", ecdsaWithSHA1: "ECDSA with SHA-1",
        p256: "P-256", p384: "P-384", p521: "P-521",
        ekuServerAuth: "serverAuth", ekuClientAuth: "clientAuth", ekuCodeSigning: "codeSigning",
        ekuEmailProtection: "emailProtection", ekuTimeStamping: "timeStamping", ekuOCSPSigning: "OCSPSigning",
        ekuDocumentSigning: "documentSigning", ekuAdobeAuthenticDocuments: "adobeAuthenticDocumentsTrust", ekuAny: "anyExtendedKeyUsage",
    ]

    static func name(_ oid: String) -> String { names[oid] ?? oid }
}
