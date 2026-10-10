import Foundation
import Observation
import SwiftUI

/// Outcome of a tool run: produced files plus an optional summary line and extra report rows.
struct JobResult: @unchecked Sendable {
    var outputs: [URL] = []
    var summary: String?
    /// Key/value lines shown under the summary (e.g. "Before → After" sizes, checks…).
    var details: [(String, String)] = []
    /// Free-form report text (verification results, OCR text, preflight findings…).
    var report: String?

    init(outputs: [URL] = [], summary: String? = nil, details: [(String, String)] = [], report: String? = nil) {
        self.outputs = outputs
        self.summary = summary
        self.details = details
        self.report = report
    }
}

/// Runs one engine job at a time for a tool page, publishing progress and the result.
@MainActor
@Observable
final class JobRunner {
    enum State {
        case idle
        case running(fraction: Double, message: String?)
        case done(JobResult)
        case failed(String)
    }

    var state: State = .idle
    @ObservationIgnored private var task: Task<Void, Never>?

    var isRunning: Bool { if case .running = state { true } else { false } }

    var result: JobResult? { if case .done(let r) = state { r } else { nil } }

    /// Runs `work` off the main thread. `label` (tool name) records the run in the Home history.
    func run(label: String? = nil, _ work: @escaping @Sendable (_ progress: @escaping ProgressHandler) async throws -> JobResult) {
        task?.cancel()
        state = .running(fraction: 0, message: nil)
        let ref = WeakRunner(self)
        task = Task { @MainActor [weak self] in
            let progress: ProgressHandler = { fraction, message in
                Task { @MainActor in
                    guard let runner = ref.value, runner.isRunning else { return }
                    runner.state = .running(fraction: fraction, message: message)
                }
            }
            do {
                let result = try await Task.detached(priority: .userInitiated) { try await work(progress) }.value
                try Task.checkCancellation()
                self?.state = .done(result)
                if let label { OperationHistory.shared.record(label: label, result: result) }
                // Settings › Files: "After an operation" → open the first PDF result in the viewer.
                if UserDefaults.standard.string(forKey: "vivepdf.files.afterOperation") == "open",
                   let pdf = result.outputs.first(where: { $0.pathExtension.lowercased() == "pdf" }) {
                    AppModel.shared.open(pdf)
                }
            } catch is CancellationError {
                self?.state = .idle
            } catch let error as EngineError where error.code == .CANCELLED {
                self?.state = .idle
            } catch {
                self?.state = .failed(error.localizedDescription)
            }
        }
    }

    func cancel() {
        task?.cancel()
        state = .idle
    }

    func reset() {
        if !isRunning { state = .idle }
    }
}

private final class WeakRunner: @unchecked Sendable {
    weak var value: JobRunner?
    init(_ value: JobRunner) { self.value = value }
}

/// The primary action button + live progress + result panel at the bottom of every tool page.
struct JobControls: View {
    let runner: JobRunner
    let title: String
    var symbol: String = "play.fill"
    var tone: Tone = .organize
    var disabled = false
    let action: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            switch runner.state {
            case .running(let fraction, let message):
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        ProgressView(value: fraction > 0 ? fraction : nil) { Text(message ?? t("tools.working")) }
                            .tint(tone.color)
                        Button(t("common.cancel"), role: .cancel) { runner.cancel() }
                            .buttonStyle(.bordered)
                    }
                }
                .card()
            default:
                Button(action: action) {
                    Label(title, systemImage: symbol)
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 30)
                }
                .buttonStyle(.borderedProminent)
                .tint(tone.color)
                .controlSize(.large)
                .disabled(disabled)
            }
            if case .failed(let message) = runner.state {
                Label(message, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(Palette.destructive)
                    .font(.callout)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card(padding: 12)
            }
            if case .done(let result) = runner.state {
                ResultPanel(result: result, tone: tone)
            }
        }
    }
}

/// "Recent operations" on the Home screen: every finished tool run with its outputs.
@Observable
final class OperationHistory {
    static let shared = OperationHistory()

    struct Entry: Codable, Identifiable, Hashable {
        var id = UUID()
        var label: String
        var date: Date
        var outputs: [String]
        var summary: String?
        var outputURLs: [URL] { outputs.map { URL(fileURLWithPath: $0) } }
    }

    private(set) var entries: [Entry] = []
    private let fileURL = Workspace.support.appendingPathComponent("history.json")

    private init() {
        if let data = try? Data(contentsOf: fileURL), let list = try? JSONDecoder().decode([Entry].self, from: data) { entries = list }
    }

    func record(label: String, result: JobResult) {
        // Settings › Startup and privacy: "Keep operation history".
        guard UserDefaults.standard.object(forKey: "vivepdf.general.keepHistory") as? Bool ?? true else { return }
        entries.insert(Entry(label: label, date: Date(), outputs: result.outputs.map(\.path), summary: result.summary), at: 0)
        if entries.count > 100 { entries = Array(entries.prefix(100)) }
        persist()
    }

    func remove(_ entry: Entry, deleteFiles: Bool) {
        if deleteFiles { entry.outputURLs.forEach { try? FileManager.default.removeItem(at: $0) } }
        entries.removeAll { $0.id == entry.id }
        persist()
    }

    func clear() {
        entries.removeAll()
        persist()
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(entries) { try? data.write(to: fileURL, options: .atomic) }
    }
}
