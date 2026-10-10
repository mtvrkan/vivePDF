import Foundation
import Observation

/// Home dashboard layout (`features/home/homeLayout.ts`): which sections show, where and how big, plus the
/// quick-access tools. Stored as JSON under the desktop key `vivepdf.homeLayout`.
enum HomeSectionID: String, CaseIterable, Codable, Identifiable {
    case hero, quickActions, recent, studio, collections, tools, `continue`, history, stats
    var id: String { rawValue }

    var titleKey: String {
        switch self {
        case .hero: "home.layout.sections.hero"
        case .quickActions: "home.quickActions"
        case .recent: "home.recent"
        case .studio: "home.studio.title"
        case .collections: "home.collections.title"
        case .tools: "home.catalog.title"
        case .continue: "home.lastSession"
        case .history: "home.history.title"
        case .stats: "home.stats.title"
        }
    }
}

enum HomeRegion: String, CaseIterable, Codable, Identifiable {
    case top, main, side, bottom
    var id: String { rawValue }
}

enum HomeSize: String, CaseIterable, Codable, Identifiable {
    case small, medium, large
    var id: String { rawValue }

    func pick<T>(_ small: T, _ medium: T, _ large: T) -> T {
        switch self {
        case .small: small
        case .medium: medium
        case .large: large
        }
    }
}

enum SidebarSide: String, CaseIterable, Codable, Identifiable {
    case start, end
    var id: String { rawValue }
}

enum SidebarWidth: String, CaseIterable, Codable, Identifiable {
    case narrow, normal, wide
    var id: String { rawValue }
    var points: Double {
        switch self {
        case .narrow: 256
        case .normal: 320
        case .wide: 416
        }
    }
}

struct HomeSectionLayout: Codable, Hashable, Identifiable {
    var id: HomeSectionID
    var region: HomeRegion
    var size: HomeSize
    var hidden: Bool
}

struct HomeLayout: Codable, Hashable {
    struct Sidebar: Codable, Hashable {
        var side: SidebarSide
        var width: SidebarWidth
    }

    static let maxQuickActions = 18

    var sections: [HomeSectionLayout]
    var sidebar: Sidebar
    var quickActions: [String]

    static var standard: HomeLayout {
        HomeLayout(
            sections: [
                .init(id: .hero, region: .main, size: .medium, hidden: false),
                .init(id: .quickActions, region: .main, size: .medium, hidden: false),
                .init(id: .recent, region: .main, size: .medium, hidden: false),
                .init(id: .studio, region: .main, size: .medium, hidden: false),
                .init(id: .collections, region: .main, size: .medium, hidden: false),
                .init(id: .tools, region: .main, size: .medium, hidden: false),
                .init(id: .continue, region: .side, size: .medium, hidden: false),
                .init(id: .history, region: .side, size: .medium, hidden: false),
                .init(id: .stats, region: .side, size: .medium, hidden: false),
            ],
            sidebar: Sidebar(side: .end, width: .normal),
            quickActions: ToolCatalog.homeQuickActionIds
        )
    }

    /// Tolerant decoding: unknown ids are dropped, missing sections come back with their defaults.
    static func normalized(from data: Data?, knownTools: Set<String>) -> HomeLayout {
        let fallback = standard
        guard let data, let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return fallback }
        var seen = Set<HomeSectionID>()
        var sections: [HomeSectionLayout] = []
        for item in raw["sections"] as? [[String: Any]] ?? [] {
            guard let id = (item["id"] as? String).flatMap(HomeSectionID.init(rawValue:)), !seen.contains(id),
                  let base = fallback.sections.first(where: { $0.id == id }) else { continue }
            seen.insert(id)
            sections.append(HomeSectionLayout(
                id: id,
                region: (item["region"] as? String).flatMap(HomeRegion.init(rawValue:)) ?? base.region,
                size: (item["size"] as? String).flatMap(HomeSize.init(rawValue:)) ?? base.size,
                hidden: item["hidden"] as? Bool == true))
        }
        sections += fallback.sections.filter { !seen.contains($0.id) }
        let sidebar = raw["sidebar"] as? [String: Any] ?? [:]
        var quick = fallback.quickActions
        if let stored = raw["quickActions"] as? [Any] {
            var unique: [String] = []
            for case let id as String in stored where knownTools.contains(id) && !unique.contains(id) { unique.append(id) }
            quick = Array(unique.prefix(maxQuickActions))
        }
        return HomeLayout(
            sections: sections,
            sidebar: Sidebar(side: (sidebar["side"] as? String).flatMap(SidebarSide.init(rawValue:)) ?? fallback.sidebar.side,
                             width: (sidebar["width"] as? String).flatMap(SidebarWidth.init(rawValue:)) ?? fallback.sidebar.width),
            quickActions: quick)
    }

    func sections(in region: HomeRegion, includeHidden: Bool = false) -> [HomeSectionLayout] {
        sections.filter { $0.region == region && (includeHidden || !$0.hidden) }
    }

    var hiddenSections: [HomeSectionLayout] { sections.filter(\.hidden) }

    /// Moves a section into `region` at visible position `index` (unhiding it), like the desktop drag & drop.
    func moving(_ id: HomeSectionID, to region: HomeRegion, at index: Int) -> HomeLayout {
        guard let moving = sections.first(where: { $0.id == id }) else { return self }
        let from = sections(in: region).firstIndex { $0.id == id }
        let slot = (from != nil && index > from!) ? index - 1 : index
        var rest = sections.filter { $0.id != id }
        let targets = rest.filter { $0.region == region && !$0.hidden }
        let clamped = max(0, min(targets.count, slot))
        var moved = moving
        moved.region = region
        moved.hidden = false
        let insertAt: Int
        if clamped < targets.count {
            insertAt = rest.firstIndex(of: targets[clamped]) ?? rest.count
        } else if let last = targets.last {
            insertAt = (rest.firstIndex(of: last) ?? rest.count - 1) + 1
        } else {
            insertAt = rest.count
        }
        rest.insert(moved, at: insertAt)
        var copy = self
        copy.sections = rest
        return copy
    }

    func shifting(_ id: HomeSectionID, by delta: Int) -> HomeLayout {
        guard let section = sections.first(where: { $0.id == id }) else { return self }
        let visible = sections(in: section.region)
        guard let index = visible.firstIndex(where: { $0.id == id }) else { return self }
        let target = index + delta
        guard target >= 0, target < visible.count else { return self }
        return moving(id, to: section.region, at: delta > 0 ? target + 1 : target)
    }

    func updating(_ id: HomeSectionID, _ change: (inout HomeSectionLayout) -> Void) -> HomeLayout {
        var copy = self
        if let index = copy.sections.firstIndex(where: { $0.id == id }) { change(&copy.sections[index]) }
        return copy
    }

    func addingQuickAction(_ toolID: String) -> HomeLayout {
        guard !quickActions.contains(toolID), quickActions.count < Self.maxQuickActions else { return self }
        var copy = self
        copy.quickActions.append(toolID)
        return copy
    }

    func removingQuickAction(_ toolID: String) -> HomeLayout {
        var copy = self
        copy.quickActions.removeAll { $0 == toolID }
        return copy
    }

    func shiftingQuickAction(_ toolID: String, by delta: Int) -> HomeLayout {
        guard let index = quickActions.firstIndex(of: toolID) else { return self }
        let target = index + delta
        guard target >= 0, target < quickActions.count else { return self }
        var copy = self
        copy.quickActions.swapAt(index, target)
        return copy
    }
}

/// Persisted, observable home layout shared by Home and the command palette ("Customize home").
@Observable
final class HomeLayoutStore {
    static let shared = HomeLayoutStore()
    static let storageKey = "vivepdf.homeLayout"

    private(set) var layout: HomeLayout
    /// Set by the palette action; Home opens its layout editor when it sees it.
    var editRequested = false

    private init() {
        let known = Set(ToolCatalog.shortcuts.map(\.id))
        layout = HomeLayout.normalized(from: UserDefaults.standard.data(forKey: Self.storageKey), knownTools: known)
    }

    func change(_ update: (HomeLayout) -> HomeLayout) {
        let next = update(layout)
        guard next != layout else { return }
        replace(next)
    }

    func replace(_ next: HomeLayout) {
        layout = next
        if let data = try? JSONEncoder().encode(next) { UserDefaults.standard.set(data, forKey: Self.storageKey) }
    }
}
