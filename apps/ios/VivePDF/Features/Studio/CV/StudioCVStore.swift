import Foundation
import Observation

/// The CV builder's state (`cvStore.ts`): profile + theme with undo/redo (typing merges into one
/// step), debounced persistence, and a toast with an optional Undo action.
@MainActor
@Observable
final class StudioCVStore {
    static let shared = StudioCVStore()

    private(set) var profile = StudioCVProfile()
    private(set) var theme = StudioCVTheme()
    private(set) var past: [StudioCVState] = []
    private(set) var future: [StudioCVState] = []
    private(set) var loaded = false
    var saveFailed = false
    var toast: Toast?

    struct Toast: Identifiable, Equatable {
        let id = UUID()
        var message: String
        var isError = false
        var undo: (() -> Void)?
        static func == (lhs: Toast, rhs: Toast) -> Bool { lhs.id == rhs.id }
    }

    @ObservationIgnored private var mergeKey: String?
    @ObservationIgnored private var mergeAt = Date.distantPast
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    private static let historyLimit = 100
    private static let mergeWindow: TimeInterval = 0.6

    var canUndo: Bool { !past.isEmpty }
    var canRedo: Bool { !future.isEmpty }
    var snapshot: StudioCVState { StudioCVState(profile: profile, theme: theme) }

    /// Loads the stored CV the first time the builder opens.
    func open(language: String) {
        guard !loaded else { return }
        let stored = StudioCVCoding.readStored(language: language)
        profile = stored?.profile ?? StudioCVProfile()
        theme = stored?.theme ?? .standard(language)
        past = []
        future = []
        mergeKey = nil
        loaded = true
    }

    func close() {
        saveTask?.cancel()
        StudioCVCoding.writeStored(snapshot)
    }

    private func commit(_ next: StudioCVState, merge: String?) {
        guard next.profile != profile || next.theme != theme else { return }
        let now = Date()
        let merging = merge != nil && merge == mergeKey && now.timeIntervalSince(mergeAt) < Self.mergeWindow
        if !merging {
            past.append(snapshot)
            if past.count > Self.historyLimit { past.removeFirst(past.count - Self.historyLimit) }
        }
        profile = next.profile
        theme = next.theme
        future = []
        mergeKey = merge
        mergeAt = now
        scheduleSave()
    }

    private func scheduleSave() {
        saveTask?.cancel()
        let state = snapshot
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            let saved = StudioCVCoding.writeStored(state)
            if let self, saved == self.saveFailed { self.saveFailed = !saved }
        }
    }

    func updateProfile(merge: String? = nil, _ change: (inout StudioCVProfile) -> Void) {
        var next = profile
        change(&next)
        commit(StudioCVState(profile: next, theme: theme), merge: merge)
    }

    func updateTheme(merge: String? = nil, _ change: (inout StudioCVTheme) -> Void) {
        var next = theme
        change(&next)
        commit(StudioCVState(profile: profile, theme: next), merge: merge)
    }

    func replace(_ state: StudioCVState) {
        commit(state, merge: nil)
    }

    func undo() {
        guard let target = past.popLast() else { return }
        future.append(snapshot)
        profile = target.profile
        theme = target.theme
        mergeKey = nil
        scheduleSave()
    }

    func redo() {
        guard let target = future.popLast() else { return }
        past.append(snapshot)
        profile = target.profile
        theme = target.theme
        mergeKey = nil
        scheduleSave()
    }

    func show(_ message: String, isError: Bool = false, undo: (() -> Void)? = nil) {
        toast = Toast(message: message, isError: isError, undo: undo)
    }

    /// Removes a list item and offers Undo (`useRemoveWithUndo`).
    func remove(_ list: StudioCVList, id: String, name: String) {
        var removed: (item: Any, index: Int)?
        updateProfile { removed = $0.remove(list, id: id) }
        guard let removed else { return }
        show(t("studio.cv.removed", ["name": name])) { [weak self] in
            self?.updateProfile { $0.restore(list, item: removed.item, index: removed.index) }
        }
    }
}
