import Foundation

/// The Lucide icon library (ISC licence) used by the desktop Studio: icon drawings pre-converted to
/// path data (`iconArt.ts`), plus the multilingual search of `iconSearch.ts` / `iconTerms.ts`.
enum StudioIcons {
    enum Category: String, CaseIterable, Identifiable {
        case arrows, shapes, communication, people, media, nature, business, travel, files, devices, food
        var id: String { rawValue }
        var labelKey: String { "studio.icons.categories.\(rawValue)" }
    }

    static let concepts = [
        "heart", "star", "arrow", "home", "user", "mail", "phone", "calendar", "clock", "check", "close", "plus", "search", "settings",
        "camera", "music", "location", "lock", "cart", "money", "gift", "sun", "moon", "weather", "plant", "book", "pen", "award", "flag",
        "bell", "globe", "car", "plane", "chart", "document", "food", "warning", "info", "idea", "face",
    ]

    struct Entry: Identifiable, Hashable {
        let name: String
        let label: String
        let slug: String
        let words: [String]
        let categories: [Category]
        var id: String { name }
    }

    /// Locale terms per concept / category (`studio.icons.terms.*` plus category labels).
    typealias LocalTerms = [String: [String]]

    static let viewSize = 24.0
    static let strokeWidth = 2.0
    static let defaultColor = "#1f2937"
    static let pageShare = 0.2

    // MARK: Data

    private struct Drawing { let outline: String; let filled: [String] }

    private static let data: (entries: [Entry], drawings: [String: Drawing]) = {
        guard let url = StudioResources.url("studio-icons", "bin"), let packed = try? Data(contentsOf: url),
              let json = try? (packed as NSData).decompressed(using: .zlib) as Data,
              let list = try? JSONSerialization.jsonObject(with: json) as? [[Any]] else { return ([], [:]) }
        var entries: [Entry] = []
        var drawings: [String: Drawing] = [:]
        entries.reserveCapacity(list.count)
        for item in list {
            guard let name = item.first as? String else { continue }
            let outline = item.count > 1 ? (item[1] as? String ?? "") : ""
            let filled = item.count > 2 ? (item[2] as? [String] ?? []) : []
            drawings[name] = Drawing(outline: outline, filled: filled)
            entries.append(entry(name))
        }
        return (entries, drawings)
    }()

    static var entries: [Entry] { data.entries }

    /// `iconArt`: outlines share one stroked path, filled primitives get their own solid paths.
    static func art(_ name: String, color: String, strokeWidth: Double = strokeWidth) -> (viewWidth: Double, viewHeight: Double, paths: [StudioVectorPath])? {
        guard let drawing = data.drawings[name] else { return nil }
        let stroke = StudioStroke(color: color, width: strokeWidth, dash: .solid, cap: .round, join: .round)
        var paths: [StudioVectorPath] = []
        if !drawing.outline.isEmpty { paths.append(StudioVectorPath(d: drawing.outline, fill: .none, stroke: stroke)) }
        for d in drawing.filled { paths.append(StudioVectorPath(d: d, fill: .solid(color), stroke: stroke)) }
        return (viewSize, viewSize, paths)
    }

    /// `insertIcon`: a vector element at 20 % of the page's shorter side, centred, in the palette's lead colour.
    static func element(_ entry: Entry, pageWidth: Double, pageHeight: Double, palette: [String]) -> StudioElement? {
        let side = jsRound(min(pageWidth, pageHeight) * pageShare)
        guard let art = art(entry.name, color: palette.first ?? defaultColor) else { return nil }
        return StudioFactory.vector(viewWidth: art.viewWidth, viewHeight: art.viewHeight, paths: art.paths, x: (pageWidth - side) / 2, y: (pageHeight - side) / 2, width: side, height: side, name: entry.label)
    }

    private static func jsRound(_ v: Double) -> Double { (v + 0.5).rounded(.down) }

    // MARK: Entries

    private static func replacing(_ text: String, _ pattern: String, _ template: String) -> String {
        text.replacingOccurrences(of: pattern, with: template, options: .regularExpression)
    }

    static func splitName(_ name: String) -> [String] {
        var s = replacing(name, "([a-z0-9])([A-Z])", "$1 $2")
        s = replacing(s, "([a-z]{2})(\\d)", "$1 $2")
        s = replacing(s, "([A-Z])([A-Z][a-z])", "$1 $2")
        return s.lowercased().split(whereSeparator: { $0.isWhitespace }).map(String.init)
    }

    private static let categoryWords: [Category: Set<String>] = [
        .arrows: ["arrow", "arrows", "chevron", "chevrons", "move", "corner", "undo", "redo", "refresh", "rotate", "repeat", "shuffle", "iteration", "merge", "split", "forward", "reply"],
        .communication: ["mail", "mails", "message", "messages", "phone", "send", "inbox", "at", "voicemail", "megaphone", "bell", "contact", "speech", "rss", "podcast", "reply"],
        .people: ["user", "users", "person", "baby", "contact", "smile", "frown", "laugh", "meh", "angry", "annoyed", "hand", "accessibility", "handshake", "footprints", "venus", "mars", "ear", "brain", "heart"],
        .media: ["play", "pause", "music", "video", "camera", "image", "images", "film", "clapperboard", "mic", "volume", "headphones", "radio", "tv", "disc", "podcast", "speaker", "cast", "aperture", "audio", "guitar", "piano", "drum"],
        .nature: ["sun", "moon", "cloud", "cloudy", "snowflake", "wind", "umbrella", "leaf", "leafy", "tree", "trees", "flower", "sprout", "droplet", "droplets", "flame", "mountain", "rainbow", "thermometer", "zap", "sunrise", "sunset", "tornado", "waves", "clover", "shell", "bird", "cat", "dog", "fish", "rabbit", "squirrel", "turtle", "bug", "feather", "snail", "rat", "worm", "paw", "bone", "flower2", "palmtree", "earth"],
        .business: ["chart", "briefcase", "wallet", "credit", "dollar", "euro", "pound", "banknote", "coins", "receipt", "piggy", "landmark", "building", "trending", "percent", "calculator", "shopping", "store", "presentation", "handshake", "gauge", "target", "badge", "scale", "bitcoin", "currency"],
        .travel: ["car", "bus", "plane", "train", "ship", "sailboat", "bike", "bicycle", "map", "compass", "globe", "earth", "house", "home", "hotel", "luggage", "tent", "caravan", "fuel", "navigation", "signpost", "route", "tram", "truck", "rocket", "ticket", "anchor", "castle", "church", "hospital", "school", "pin", "tickets"],
        .files: ["file", "files", "folder", "folders", "clipboard", "archive", "paperclip", "book", "notebook", "sticky", "notepad", "scroll", "newspaper", "library", "bookmark", "copy", "save", "text"],
        .devices: ["laptop", "monitor", "smartphone", "tablet", "cpu", "wifi", "bluetooth", "battery", "database", "server", "hard", "keyboard", "mouse", "printer", "plug", "usb", "cable", "router", "webcam", "watch", "gamepad", "joystick", "code", "terminal", "computer", "phone", "memory", "satellite"],
        .food: ["coffee", "cup", "pizza", "apple", "cake", "utensils", "wine", "beer", "egg", "cookie", "ice", "soup", "salad", "sandwich", "croissant", "carrot", "cherry", "citrus", "grape", "banana", "candy", "popcorn", "milk", "beef", "ham", "drumstick", "cooking", "chef", "martini", "lollipop", "dessert", "donut", "hamburger", "vegan", "wheat", "bean", "nut", "glass", "bottle", "pot", "microwave", "refrigerator"],
    ]

    private static let shapeWords: Set<String> = ["circle", "square", "triangle", "hexagon", "octagon", "pentagon", "diamond", "star", "heart", "cone", "cylinder", "torus", "pyramid", "squircle", "shapes", "dashed", "dot", "half", "right", "rectangle", "horizontal", "vertical", "spline", "blend", "box", "cuboid", "ellipse", "small", "large"]
    private static let weakShapeWords: Set<String> = ["dashed", "half", "right", "small", "large"]

    private static func categories(_ words: [String]) -> [Category] {
        Category.allCases.filter { category in
            if category == .shapes {
                return words.allSatisfy(shapeWords.contains) && words.contains { shapeWords.contains($0) && !weakShapeWords.contains($0) }
            }
            return words.contains { categoryWords[category]?.contains($0) == true }
        }
    }

    static func entry(_ name: String) -> Entry {
        let words = splitName(name)
        let label = words.joined(separator: " ")
        return Entry(name: name, label: label.prefix(1).uppercased() + label.dropFirst(), slug: words.joined(separator: "-"), words: words, categories: categories(words))
    }

    // MARK: Search

    private static let concepts_: [String: (synonyms: [String], targets: [String])] = [
        "heart": (["love", "like", "favourite", "favorite", "romance"], ["heart"]),
        "star": (["favourite", "favorite", "rating", "review"], ["star", "sparkles"]),
        "arrow": (["direction", "pointer", "next", "back"], ["arrow", "chevron", "move"]),
        "home": (["house", "start"], ["house", "home"]),
        "user": (["person", "profile", "account", "people", "team", "member", "avatar"], ["user", "users", "contact"]),
        "mail": (["email", "envelope", "letter", "post"], ["mail", "inbox", "send"]),
        "phone": (["call", "telephone", "mobile", "contact"], ["phone", "smartphone"]),
        "calendar": (["date", "event", "schedule", "day", "appointment"], ["calendar"]),
        "clock": (["time", "hour", "watch", "timer", "deadline"], ["clock", "timer", "alarm", "hourglass", "watch"]),
        "check": (["tick", "ok", "done", "success", "yes", "approved"], ["check"]),
        "close": (["cancel", "remove", "delete", "cross", "no", "wrong"], ["x"]),
        "plus": (["add", "new", "create"], ["plus"]),
        "search": (["find", "magnifier", "lookup", "zoom"], ["search"]),
        "settings": (["gear", "cog", "options", "preferences", "configure"], ["settings", "cog", "sliders"]),
        "camera": (["photo", "picture", "photography", "image", "gallery"], ["camera", "image", "images"]),
        "music": (["song", "audio", "sound", "note", "melody"], ["music", "headphones", "volume"]),
        "location": (["place", "pin", "map", "address", "marker", "venue"], ["map", "pin", "navigation", "compass"]),
        "lock": (["security", "password", "private", "secure", "safe"], ["lock", "shield", "key"]),
        "cart": (["shop", "shopping", "buy", "basket", "store", "sale"], ["shopping", "store"]),
        "money": (["cash", "payment", "price", "finance", "pay", "bank", "currency"], ["banknote", "coins", "dollar", "euro", "wallet", "piggy", "credit", "receipt"]),
        "gift": (["present", "birthday", "party", "celebration"], ["gift", "party", "cake"]),
        "sun": (["day", "summer", "bright", "sunny"], ["sun"]),
        "moon": (["night", "dark", "sleep"], ["moon"]),
        "weather": (["rain", "snow", "forecast", "storm"], ["cloud", "umbrella", "snowflake", "wind", "thermometer"]),
        "plant": (["nature", "garden", "flower", "green", "eco"], ["flower", "leaf", "sprout", "tree", "clover", "trees"]),
        "book": (["read", "reading", "library", "education", "study"], ["book", "library", "notebook"]),
        "pen": (["write", "edit", "pencil", "sign", "draw"], ["pen", "pencil", "signature"]),
        "award": (["prize", "winner", "medal", "trophy", "badge", "achievement"], ["trophy", "award", "medal", "crown"]),
        "flag": (["report", "country", "goal", "milestone"], ["flag"]),
        "bell": (["notification", "alert", "alarm", "reminder"], ["bell"]),
        "globe": (["world", "earth", "internet", "web", "international"], ["globe", "earth"]),
        "car": (["vehicle", "drive", "transport", "taxi", "traffic"], ["car", "bus", "truck", "bike", "train"]),
        "plane": (["travel", "flight", "airport", "trip", "holiday", "vacation"], ["plane", "luggage", "ticket"]),
        "chart": (["graph", "statistics", "report", "data", "analytics", "growth"], ["chart", "trending", "gauge"]),
        "document": (["file", "paper", "page", "folder", "paperwork"], ["file", "files", "folder", "clipboard"]),
        "food": (["eat", "meal", "restaurant", "drink", "dinner", "lunch", "breakfast"], ["utensils", "pizza", "coffee", "cup", "apple", "sandwich", "soup", "cake", "wine", "beer", "salad"]),
        "warning": (["alert", "danger", "caution", "error", "attention"], ["alert", "siren"]),
        "info": (["information", "help", "question", "faq", "support"], ["info", "help", "question"]),
        "idea": (["lamp", "bulb", "light", "creative", "tip"], ["lightbulb", "lamp", "sparkles"]),
        "face": (["happy", "emoji", "smiley", "mood", "sad"], ["smile", "laugh", "frown", "meh", "annoyed", "angry"]),
    ]

    static let featured = ["Heart", "Star", "Check", "Phone", "Mail", "MapPin", "Calendar", "Clock", "User", "House", "Globe", "ShoppingCart", "Gift", "Award", "Sun", "Camera", "Music", "Lightbulb", "Leaf", "Coffee", "Plane", "ThumbsUp", "Smile", "Sparkles"]
    private static let featuredRank: [String: Int] = Dictionary(uniqueKeysWithValues: featured.enumerated().map { ($1, $0) })

    static func normalizeTerm(_ value: String) -> String {
        let scalars = value.decomposedStringWithCanonicalMapping.unicodeScalars.filter {
            switch $0.properties.generalCategory {
            case .nonspacingMark, .spacingMark, .enclosingMark: false
            default: true
            }
        }
        return String(String.UnicodeScalarView(scalars)).lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Local terms from the current language (`localTerms` in IconsSection.tsx).
    static func localTerms() -> LocalTerms {
        var terms: LocalTerms = [:]
        func split(_ value: String) -> [String] {
            value.split(whereSeparator: { ",،、，".contains($0) }).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        }
        for concept in concepts { terms[concept] = split(t("studio.icons.terms.\(concept)")) }
        for category in Category.allCases { terms[category.rawValue, default: []].append(t(category.labelKey)) }
        return terms
    }

    private static func directScore(_ entry: Entry, _ term: String) -> Int {
        if entry.slug == term || entry.words.joined() == term { return 100 }
        if let index = entry.words.firstIndex(of: term) { return index == 0 ? 70 : 60 }
        if let prefix = entry.words.firstIndex(where: { $0.hasPrefix(term) }) { return prefix == 0 ? 45 : 40 }
        return term.count >= 3 && entry.slug.contains(term) ? 15 : 0
    }

    private static func matches(_ candidates: [String], _ term: String) -> Int {
        var best = 0
        for candidate in candidates {
            let normalized = normalizeTerm(candidate)
            if normalized.isEmpty { continue }
            if normalized == term { return 2 }
            if term.count >= 2 && normalized.hasPrefix(term) { best = 1 }
        }
        return best
    }

    private struct Plan {
        let term: String
        let concepts: [(targets: [String], score: Int)]
        let categories: [(category: Category, score: Int)]
    }

    private static func plan(_ term: String, _ local: LocalTerms) -> Plan {
        let conceptHits: [(targets: [String], score: Int)] = concepts.compactMap { concept in
            guard let info = concepts_[concept] else { return nil }
            let strength = max(matches([concept] + info.synonyms, term), matches(local[concept] ?? [], term))
            return strength > 0 ? (info.targets, strength == 2 ? 35 : 25) : nil
        }
        let categoryHits: [(category: Category, score: Int)] = Category.allCases.compactMap { category in
            let strength = max(matches([category.rawValue], term), matches(local[category.rawValue] ?? [], term))
            return strength == 2 || (strength > 0 && term.count >= 3) ? (category, strength == 2 ? 12 : 8) : nil
        }
        return Plan(term: term, concepts: conceptHits, categories: categoryHits)
    }

    private static func termScore(_ entry: Entry, _ step: Plan) -> Int {
        var score = directScore(entry, step.term)
        for concept in step.concepts where concept.score > score && entry.words.contains(where: concept.targets.contains) { score = concept.score }
        for category in step.categories where category.score > score && entry.categories.contains(category.category) { score = category.score }
        return score
    }

    private static let english = Locale(identifier: "en")

    private static func labelOrder(_ a: Entry, _ b: Entry) -> Bool {
        a.label.compare(b.label, options: [], range: nil, locale: english) == .orderedAscending
    }

    static func search(_ query: String, category: Category? = nil, local: LocalTerms = [:], in pool: [Entry]? = nil) -> [Entry] {
        let all = pool ?? entries
        let candidates = category.map { c in all.filter { $0.categories.contains(c) } } ?? all
        let terms = normalizeTerm(query).split(whereSeparator: { $0.isWhitespace || $0 == "," || $0 == "-" || $0 == "_" }).map(String.init)
        if terms.isEmpty {
            return candidates.sorted { a, b in
                let ra = featuredRank[a.name] ?? Int.max, rb = featuredRank[b.name] ?? Int.max
                return ra != rb ? ra < rb : labelOrder(a, b)
            }
        }
        let steps = terms.map { plan($0, local) }
        let whole = terms.joined(separator: "-")
        var scored: [(Entry, Int)] = []
        for entry in candidates {
            var total = entry.slug == whole ? 100 : 0
            var missing = false
            for step in steps {
                let s = termScore(entry, step)
                if s == 0 { missing = true; break }
                total += s
            }
            if !missing { scored.append((entry, total)) }
        }
        return scored.sorted { a, b in
            if a.1 != b.1 { return a.1 > b.1 }
            if a.0.words.count != b.0.words.count { return a.0.words.count < b.0.words.count }
            return labelOrder(a.0, b.0)
        }.map(\.0)
    }
}
