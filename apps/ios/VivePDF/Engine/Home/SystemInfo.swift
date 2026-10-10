import Foundation
import UIKit
import Vision

/// Version and device facts for About, Settings › Updates and bug reports.
enum AppInfo {
    static var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—" }
    static var build: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "—" }
    static let websiteURL = URL(string: "https://vivepdf.com")!
    static let repositoryURL = URL(string: "https://github.com/mtvrkan/vivePDF")!
    static let issuesURL = URL(string: "https://github.com/mtvrkan/vivePDF/issues/new")!
    static let contributorsAPI = URL(string: "https://api.github.com/repos/mtvrkan/vivePDF/contributors?per_page=50")!

    /// Hardware identifier such as "iPhone16,1".
    static var deviceModel: String {
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: &info.machine) { buffer in
            String(decoding: buffer.prefix { $0 != 0 }, as: UTF8.self)
        }
    }

    @MainActor
    static var diagnostics: String {
        let device = UIDevice.current
        return [
            "vivePDF \(version) (\(build))",
            "\(device.systemName) \(device.systemVersion) · \(deviceModel)",
            "Locale: \(L10n.shared.locale.rawValue) · \(Locale.current.identifier)",
            "OCR: \(OCRLanguageCatalog.supported.joined(separator: ", "))",
        ].joined(separator: "\n")
    }
}

/// Text-recognition languages iOS ships (Vision), in place of downloadable Tesseract packs.
enum OCRLanguageCatalog {
    static let defaultKey = "vivepdf.tools.ocrLanguage"

    static let supported: [String] = {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        return (try? request.supportedRecognitionLanguages()) ?? []
    }()

    static func displayName(_ code: String, locale: Locale) -> String {
        locale.localizedString(forIdentifier: code) ?? code
    }

    /// The chosen default (Settings › Tools) or the app language plus English when available.
    static func defaultLanguages(appLocale: AppLocale) -> [String] {
        if let stored = UserDefaults.standard.string(forKey: defaultKey), !stored.isEmpty, supported.contains(stored) {
            return [stored]
        }
        let base = appLocale.rawValue.split(separator: "-").first.map(String.init) ?? "en"
        var result = supported.filter { $0.hasPrefix(base) }.prefix(1).map { $0 }
        if let english = supported.first(where: { $0.hasPrefix("en") }), !result.contains(english) { result.append(english) }
        return result
    }
}
