import Foundation
import UniformTypeIdentifiers

/// Where files live on iOS. The desktop app writes next to the source or into a chosen output folder;
/// on iOS results go to `Documents/vivePDF` (visible in the Files app under "On My iPhone/iPad › vivePDF")
/// and can then be shared or exported anywhere with the share sheet / "Save to Files".
enum Workspace {
    static var documents: URL { FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0] }

    /// Default output folder (user visible).
    static var outputFolder: URL { ensure(documents.appendingPathComponent("vivePDF", isDirectory: true)) }

    /// App-private state: recents, collections, studio projects, certificates, caches.
    static var support: URL { ensure(FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("vivePDF", isDirectory: true)) }

    static func supportFolder(_ name: String) -> URL { ensure(support.appendingPathComponent(name, isDirectory: true)) }

    /// A fresh scratch folder for one job; cleaned by the system eventually.
    static func scratch() -> URL {
        ensure(FileManager.default.temporaryDirectory.appendingPathComponent("vivepdf-\(UUID().uuidString)", isDirectory: true))
    }

    @discardableResult
    static func ensure(_ url: URL) -> URL {
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    /// `report.pdf` + suffix `compressed` → `Documents/vivePDF/report-compressed.pdf`, never overwriting
    /// (`report-compressed (2).pdf` …), the same naming the desktop engine uses.
    static func output(for source: URL?, suffix: String? = nil, ext: String, in folder: URL? = nil) -> URL {
        let base = source?.deletingPathExtension().lastPathComponent ?? "vivePDF"
        let name = suffix.map { outputName(stem: base, suffix: $0) } ?? base
        return unique(name: name, ext: ext, in: folder ?? outputFolder)
    }

    /// Output name from the Settings › Files pattern (`vivepdf.outputPattern`, default `{name}-{suffix}`), with
    /// `{date}` `{time}` `{year}` filled in and characters that are not allowed in file names replaced.
    static func outputName(stem: String, suffix: String, pattern custom: String? = nil, now: Date = Date()) -> String {
        let defaultPattern = "{name}-{suffix}"
        var pattern = custom ?? UserDefaults.standard.string(forKey: "vivepdf.outputPattern") ?? defaultPattern
        if pattern.trimmingCharacters(in: .whitespaces).isEmpty || !["{name}", "{date}", "{time}"].contains(where: pattern.contains) {
            pattern = defaultPattern
        }
        guard pattern != defaultPattern else { return "\(stem)-\(suffix)" }
        let c = Calendar(identifier: .gregorian).dateComponents([.year, .month, .day, .hour, .minute, .second], from: now)
        let values = ["name": stem, "suffix": suffix,
                      "date": String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0),
                      "time": String(format: "%02d-%02d-%02d", c.hour ?? 0, c.minute ?? 0, c.second ?? 0),
                      "year": String(c.year ?? 0)]
        var name = pattern
        for (key, value) in values { name = name.replacingOccurrences(of: "{\(key)}", with: value) }
        let forbidden = CharacterSet(charactersIn: "<>:\"/\\|?*").union(.controlCharacters)
        name = String(name.unicodeScalars.map { forbidden.contains($0) ? "-" : Character($0) })
            .trimmingCharacters(in: CharacterSet(charactersIn: " ._-"))
        return name.isEmpty ? "\(stem)-\(suffix)" : String(name.prefix(120))
    }

    static func unique(name: String, ext: String, in folder: URL) -> URL {
        let fm = FileManager.default
        var candidate = folder.appendingPathComponent(name).appendingPathExtension(ext)
        var counter = 2
        while fm.fileExists(atPath: candidate.path) {
            candidate = folder.appendingPathComponent("\(name) (\(counter))").appendingPathExtension(ext)
            counter += 1
        }
        return candidate
    }

    /// Folder for a multi-file result (split, images export…).
    static func outputDirectory(for source: URL?, suffix: String) -> URL {
        let base = source?.deletingPathExtension().lastPathComponent ?? "vivePDF"
        var candidate = outputFolder.appendingPathComponent("\(base)-\(suffix)", isDirectory: true)
        var counter = 2
        while FileManager.default.fileExists(atPath: candidate.path) {
            candidate = outputFolder.appendingPathComponent("\(base)-\(suffix) (\(counter))", isDirectory: true)
            counter += 1
        }
        return ensure(candidate)
    }

    /// Copies a picked (security-scoped) file into a private inbox so engines can read it freely.
    static func importCopy(of url: URL) throws -> URL {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let inbox = supportFolder("Inbox")
        let dest = unique(name: url.deletingPathExtension().lastPathComponent, ext: url.pathExtension, in: inbox)
        var coordError: NSError?
        var copyError: Error?
        NSFileCoordinator().coordinate(readingItemAt: url, options: .withoutChanges, error: &coordError) { readURL in
            do { try FileManager.default.copyItem(at: readURL, to: dest) } catch { copyError = error }
        }
        if let error = coordError ?? copyError { throw error }
        return dest
    }

    static func fileSize(_ url: URL) -> Int64 {
        (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize).map(Int64.init) ?? 0
    }

    static func formatBytes(_ bytes: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
    }

    static func contentType(of url: URL) -> UTType? {
        (try? url.resourceValues(forKeys: [.contentTypeKey]).contentType) ?? UTType(filenameExtension: url.pathExtension)
    }
}

/// Runs `body` with security-scoped access to `url` (no-op for app-owned files).
func withSecurityScope<T>(_ url: URL, _ body: () throws -> T) rethrows -> T {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    return try body()
}

func withSecurityScope<T>(_ url: URL, _ body: () async throws -> T) async rethrows -> T {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    return try await body()
}

extension UTType {
    static let markdown = UTType(filenameExtension: "md") ?? .plainText
    static let docx = UTType("org.openxmlformats.wordprocessingml.document") ?? .data
    static let xlsx = UTType("org.openxmlformats.spreadsheetml.sheet") ?? .data
    static let pptx = UTType("org.openxmlformats.presentationml.presentation") ?? .data
    static let epub = UTType("org.idpf.epub-container") ?? .data
    static let p12 = UTType(filenameExtension: "p12") ?? .data
    static let pfx = UTType(filenameExtension: "pfx") ?? .data
    static let cer = UTType(filenameExtension: "cer") ?? .data
    static let fdf = UTType(filenameExtension: "fdf") ?? .data
    static let xfdf = UTType(filenameExtension: "xfdf") ?? .xml
    static let csv = UTType.commaSeparatedText
    static let vivestudio = UTType(filenameExtension: "vivestudio") ?? .json
    /// Everything the "file to PDF" converter accepts.
    static let convertible: [UTType] = [.pdf, .image, .plainText, .markdown, .html, .rtf, .docx, .xlsx, .pptx, .svg, .epub,
                                        UTType("com.microsoft.word.doc"), UTType("com.microsoft.excel.xls"), UTType("com.microsoft.powerpoint.ppt"),
                                        UTType(filenameExtension: "odt"), UTType(filenameExtension: "ods"), UTType(filenameExtension: "odp")].compactMap { $0 }
}
