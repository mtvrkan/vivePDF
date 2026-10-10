import Foundation

// Port of `features/studio/cv/cvModel.ts` + `cvEdits.ts`: the CV profile and theme, their normalising
// readers (shared with the desktop `vivepdf-cv` JSON format) and list editing helpers.

enum StudioCVSection: String, CaseIterable, Codable, Identifiable {
    case summary, experience, education, skills, languages, certificates, projects, references, interests, custom
    var id: String { rawValue }
}

enum StudioCVContactKind: String, CaseIterable, Codable, Identifiable {
    case email, phone, website, location, linkedin, github, other
    var id: String { rawValue }
}

enum StudioCVLayoutId: String, CaseIterable, Codable, Identifiable {
    case modern, classic, corporate, minimal, creative, timeline, compact, elegant, tech, ats, executive, academic, designer, infographic
    var id: String { rawValue }
}

enum StudioCVPhotoShape: String, CaseIterable, Codable, Identifiable { case circle, rounded, square, none; var id: String { rawValue } }
enum StudioCVSkillStyle: String, CaseIterable, Codable, Identifiable { case bars, dots, chips, text; var id: String { rawValue } }
enum StudioCVPaper: String, CaseIterable, Codable, Identifiable { case a4, letter; var id: String { rawValue } }
enum StudioCVDensity: String, CaseIterable, Codable, Identifiable { case compact, normal, roomy; var id: String { rawValue } }

enum StudioCVLimits {
    static let maxLevel = 5
    static let textLimit = 4000
    static let fileFormat = "vivepdf-cv"
    static let fileVersion = 1
}

/// Lists that can be added to, reordered and removed (`CV_LIMITS`).
enum StudioCVList: String, CaseIterable {
    case contacts, experience, education, skills, languages, certificates, projects, references, custom
    var limit: Int {
        switch self {
        case .contacts: 10
        case .experience: 30
        case .education: 20
        case .skills: 60
        case .languages: 20
        case .certificates: 30
        case .projects: 30
        case .references: 10
        case .custom: 10
        }
    }
}

private var studioCVSequence = 0

func studioCVId() -> String {
    studioCVSequence += 1
    let time = String(Int(Date().timeIntervalSince1970 * 1000), radix: 36)
    return "cv\(time)\(String(studioCVSequence, radix: 36))"
}

struct StudioCVContact: Identifiable, Equatable, Hashable {
    var id = studioCVId()
    var kind: StudioCVContactKind = .email
    var value = ""
}

struct StudioCVExperience: Identifiable, Equatable, Hashable {
    var id = studioCVId()
    var role = ""
    var organisation = ""
    var location = ""
    var start = ""
    var end = ""
    var current = false
    var details = ""
}

struct StudioCVEducation: Identifiable, Equatable, Hashable {
    var id = studioCVId()
    var degree = ""
    var school = ""
    var location = ""
    var start = ""
    var end = ""
    var current = false
    var details = ""
}

struct StudioCVLeveled: Identifiable, Equatable, Hashable {
    var id = studioCVId()
    var name = ""
    var level = 3
}

struct StudioCVCertificate: Identifiable, Equatable, Hashable {
    var id = studioCVId()
    var name = ""
    var issuer = ""
    var date = ""
}

struct StudioCVProject: Identifiable, Equatable, Hashable {
    var id = studioCVId()
    var name = ""
    var link = ""
    var details = ""
}

struct StudioCVReference: Identifiable, Equatable, Hashable {
    var id = studioCVId()
    var name = ""
    var role = ""
    var contact = ""
}

struct StudioCVCustom: Identifiable, Equatable, Hashable {
    var id = studioCVId()
    var heading = ""
    var body = ""
}

struct StudioCVProfile: Equatable, Hashable {
    var name = ""
    var headline = ""
    /// Absolute path of the photo copied into the app (desktop stores a file path too).
    var photo: String? = nil
    var photoCrop: StudioCrop? = nil
    var contacts: [StudioCVContact] = [StudioCVContact(kind: .email), StudioCVContact(kind: .phone), StudioCVContact(kind: .location)]
    var summary = ""
    var experience: [StudioCVExperience] = [StudioCVExperience()]
    var education: [StudioCVEducation] = [StudioCVEducation()]
    var skills: [StudioCVLeveled] = []
    var languages: [StudioCVLeveled] = []
    var certificates: [StudioCVCertificate] = []
    var projects: [StudioCVProject] = []
    var references: [StudioCVReference] = []
    var interests = ""
    var custom: [StudioCVCustom] = []
    var order: [StudioCVSection] = StudioCVSection.allCases
    var hidden: [StudioCVSection] = []

    static func empty() -> StudioCVProfile { StudioCVProfile() }

    func count(_ list: StudioCVList) -> Int {
        switch list {
        case .contacts: contacts.count
        case .experience: experience.count
        case .education: education.count
        case .skills: skills.count
        case .languages: languages.count
        case .certificates: certificates.count
        case .projects: projects.count
        case .references: references.count
        case .custom: custom.count
        }
    }

    func canAdd(_ list: StudioCVList, count: Int = 1) -> Bool { self.count(list) + count <= list.limit }

    /// `sectionVisible`: hidden sections and sections without content are left out of the CV.
    func isVisible(_ key: StudioCVSection) -> Bool {
        if hidden.contains(key) { return false }
        func filled(_ values: [String]) -> Bool { values.contains { !$0.cvTrimmed.isEmpty } }
        switch key {
        case .summary: return !summary.cvTrimmed.isEmpty
        case .interests: return !interests.cvTrimmed.isEmpty
        case .experience: return experience.contains { filled([$0.role, $0.organisation, $0.details]) }
        case .education: return education.contains { filled([$0.degree, $0.school, $0.details]) }
        case .skills: return skills.contains { !$0.name.cvTrimmed.isEmpty }
        case .languages: return languages.contains { !$0.name.cvTrimmed.isEmpty }
        case .certificates: return certificates.contains { !$0.name.cvTrimmed.isEmpty }
        case .projects: return projects.contains { !$0.name.cvTrimmed.isEmpty || !$0.details.cvTrimmed.isEmpty }
        case .references: return references.contains { !$0.name.cvTrimmed.isEmpty }
        case .custom: return custom.contains { !$0.heading.cvTrimmed.isEmpty || !$0.body.cvTrimmed.isEmpty }
        }
    }

    var hasContent: Bool {
        var shown = self
        shown.hidden = []
        return !name.cvTrimmed.isEmpty || !headline.cvTrimmed.isEmpty || photo != nil || StudioCVSection.allCases.contains(where: shown.isVisible) || contacts.contains { !$0.value.cvTrimmed.isEmpty }
    }

    // MARK: List edits (`cvEdits.ts`)

    mutating func move(_ list: StudioCVList, from: Int, to: Int) {
        func shift<T>(_ items: inout [T]) {
            guard items.indices.contains(from), items.indices.contains(to), from != to else { return }
            items.insert(items.remove(at: from), at: to)
        }
        switch list {
        case .contacts: shift(&contacts)
        case .experience: shift(&experience)
        case .education: shift(&education)
        case .skills: shift(&skills)
        case .languages: shift(&languages)
        case .certificates: shift(&certificates)
        case .projects: shift(&projects)
        case .references: shift(&references)
        case .custom: shift(&custom)
        }
    }

    /// Removes an item; returns what is needed to restore it (remove-with-undo).
    mutating func remove(_ list: StudioCVList, id: String) -> (item: Any, index: Int)? {
        func take<T: Identifiable>(_ items: inout [T]) -> (Any, Int)? where T.ID == String {
            guard let index = items.firstIndex(where: { $0.id == id }) else { return nil }
            return (items.remove(at: index), index)
        }
        switch list {
        case .contacts: return take(&contacts)
        case .experience: return take(&experience)
        case .education: return take(&education)
        case .skills: return take(&skills)
        case .languages: return take(&languages)
        case .certificates: return take(&certificates)
        case .projects: return take(&projects)
        case .references: return take(&references)
        case .custom: return take(&custom)
        }
    }

    mutating func restore(_ list: StudioCVList, item: Any, index: Int) {
        func put<T: Identifiable>(_ items: inout [T]) where T.ID == String {
            guard let value = item as? T, !items.contains(where: { $0.id == value.id }), items.count < list.limit else { return }
            items.insert(value, at: min(index, items.count))
        }
        switch list {
        case .contacts: put(&contacts)
        case .experience: put(&experience)
        case .education: put(&education)
        case .skills: put(&skills)
        case .languages: put(&languages)
        case .certificates: put(&certificates)
        case .projects: put(&projects)
        case .references: put(&references)
        case .custom: put(&custom)
        }
    }

    /// Duplicates an item right after itself; returns the new id.
    mutating func duplicate(_ list: StudioCVList, id: String) -> String? {
        guard canAdd(list) else { return nil }
        func copy<T: Identifiable>(_ items: inout [T], _ renew: (inout T) -> Void) -> String? where T.ID == String {
            guard let index = items.firstIndex(where: { $0.id == id }) else { return nil }
            var clone = items[index]
            renew(&clone)
            items.insert(clone, at: index + 1)
            return clone.id
        }
        switch list {
        case .contacts: return copy(&contacts) { $0.id = studioCVId() }
        case .experience: return copy(&experience) { $0.id = studioCVId() }
        case .education: return copy(&education) { $0.id = studioCVId() }
        case .skills: return copy(&skills) { $0.id = studioCVId() }
        case .languages: return copy(&languages) { $0.id = studioCVId() }
        case .certificates: return copy(&certificates) { $0.id = studioCVId() }
        case .projects: return copy(&projects) { $0.id = studioCVId() }
        case .references: return copy(&references) { $0.id = studioCVId() }
        case .custom: return copy(&custom) { $0.id = studioCVId() }
        }
    }
}

struct StudioCVTheme: Equatable, Hashable {
    var layout: StudioCVLayoutId = .modern
    var accent: String? = nil
    var headingFont: String? = nil
    var bodyFont: String? = nil
    var photoShape: StudioCVPhotoShape = .circle
    var skillStyle: StudioCVSkillStyle = .bars
    var paper: StudioCVPaper = .a4
    var density: StudioCVDensity = .normal
    var language: String = "en"

    static func standard(_ language: String) -> StudioCVTheme { StudioCVTheme(language: language) }
}

struct StudioCVState: Equatable, Hashable {
    var profile: StudioCVProfile
    var theme: StudioCVTheme
}

extension String {
    var cvTrimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}

// MARK: - Reading / writing

enum StudioCVCoding {
    typealias Object = [String: Any]

    private static func str(_ value: Any?, _ limit: Int = StudioCVLimits.textLimit) -> String {
        guard let s = value as? String else { return "" }
        return String(s.prefix(limit))
    }

    private static func list<T>(_ value: Any?, _ limit: Int, _ read: (Object) -> T) -> [T] {
        guard let array = value as? [Any] else { return [] }
        return array.compactMap { $0 as? Object }.prefix(limit).map(read)
    }

    private static func level(_ value: Any?, _ fallback: Int) -> Int {
        guard StudioJSON.isNumber(value), let n = value as? NSNumber else { return fallback }
        return max(0, min(StudioCVLimits.maxLevel, Int(n.doubleValue.rounded())))
    }

    private static func fraction(_ value: Any?) -> Double? {
        guard StudioJSON.isNumber(value), let d = (value as? NSNumber)?.doubleValue, d >= 0, d <= 1 else { return nil }
        return d
    }

    private static func photoCrop(_ value: Any?) -> StudioCrop? {
        guard let raw = value as? Object, let x = fraction(raw["x"]), let y = fraction(raw["y"]), let w = fraction(raw["width"]), let h = fraction(raw["height"]),
              w > 0, h > 0, x + w <= 1.0001, y + h <= 1.0001 else { return nil }
        return StudioCrop(x: x, y: y, width: w, height: h)
    }

    private static func sectionKeys(_ value: Any?) -> [StudioCVSection] {
        var seen: [StudioCVSection] = []
        for item in value as? [Any] ?? [] {
            if let key = (item as? String).flatMap(StudioCVSection.init(rawValue:)), !seen.contains(key) { seen.append(key) }
        }
        return seen
    }

    private static func fontId(_ value: Any?) -> String? {
        guard let s = value as? String, !s.isEmpty, s.count <= 200 else { return nil }
        return s
    }

    private static func oneOf<T: RawRepresentable>(_ value: Any?, _ fallback: T) -> T where T.RawValue == String {
        (value as? String).flatMap(T.init(rawValue:)) ?? fallback
    }

    static func profile(_ value: Any?) -> StudioCVProfile {
        guard let raw = value as? Object else { return .empty() }
        var p = StudioCVProfile()
        p.name = str(raw["name"], 200)
        p.headline = str(raw["headline"], 200)
        if let photo = raw["photo"] as? String, !photo.isEmpty { p.photo = photo } else { p.photo = nil }
        p.photoCrop = photoCrop(raw["photoCrop"])
        p.contacts = list(raw["contacts"], StudioCVList.contacts.limit) { StudioCVContact(kind: oneOf($0["kind"], StudioCVContactKind.other), value: str($0["value"], 300)) }
        p.summary = str(raw["summary"])
        p.experience = list(raw["experience"], StudioCVList.experience.limit) {
            StudioCVExperience(role: str($0["role"], 200), organisation: str($0["organisation"], 200), location: str($0["location"], 200), start: str($0["start"], 40), end: str($0["end"], 40), current: StudioJSON.bool($0["current"]) == true, details: str($0["details"]))
        }
        p.education = list(raw["education"], StudioCVList.education.limit) {
            StudioCVEducation(degree: str($0["degree"], 200), school: str($0["school"], 200), location: str($0["location"], 200), start: str($0["start"], 40), end: str($0["end"], 40), current: StudioJSON.bool($0["current"]) == true, details: str($0["details"]))
        }
        p.skills = list(raw["skills"], StudioCVList.skills.limit) { StudioCVLeveled(name: str($0["name"], 120), level: level($0["level"], 3)) }
        p.languages = list(raw["languages"], StudioCVList.languages.limit) { StudioCVLeveled(name: str($0["name"], 120), level: level($0["level"], 3)) }
        p.certificates = list(raw["certificates"], StudioCVList.certificates.limit) { StudioCVCertificate(name: str($0["name"], 200), issuer: str($0["issuer"], 200), date: str($0["date"], 40)) }
        p.projects = list(raw["projects"], StudioCVList.projects.limit) { StudioCVProject(name: str($0["name"], 200), link: str($0["link"], 300), details: str($0["details"])) }
        p.references = list(raw["references"], StudioCVList.references.limit) { StudioCVReference(name: str($0["name"], 200), role: str($0["role"], 200), contact: str($0["contact"], 300)) }
        p.interests = str(raw["interests"], 1000)
        p.custom = list(raw["custom"], StudioCVList.custom.limit) { StudioCVCustom(heading: str($0["heading"], 120), body: str($0["body"])) }
        let known = sectionKeys(raw["order"])
        p.order = known + StudioCVSection.allCases.filter { !known.contains($0) }
        p.hidden = sectionKeys(raw["hidden"])
        return p
    }

    static func theme(_ value: Any?, language: String) -> StudioCVTheme {
        let fallback = StudioCVTheme.standard(language)
        guard let raw = value as? Object else { return fallback }
        var theme = fallback
        theme.layout = oneOf(raw["layout"], fallback.layout)
        if let accent = raw["accent"] as? String, StudioJSON.isColour(accent) { theme.accent = accent.lowercased() }
        theme.headingFont = fontId(raw["headingFont"])
        theme.bodyFont = fontId(raw["bodyFont"])
        theme.photoShape = oneOf(raw["photoShape"], fallback.photoShape)
        theme.skillStyle = oneOf(raw["skillStyle"], fallback.skillStyle)
        theme.paper = oneOf(raw["paper"], fallback.paper)
        theme.density = oneOf(raw["density"], fallback.density)
        if let lang = raw["language"] as? String, AppLocale(rawValue: lang) != nil { theme.language = lang }
        return theme
    }

    // MARK: Encoding (`cvToJson` / localStorage shape)

    static func encode(_ profile: StudioCVProfile, withIds: Bool) -> Object {
        func item(_ id: String, _ fields: Object) -> Object {
            var o = fields
            if withIds { o["id"] = id }
            return o
        }
        var o: Object = [
            "name": profile.name, "headline": profile.headline,
            "photo": profile.photo.map { $0 as Any } ?? NSNull(),
            "photoCrop": profile.photoCrop.map { ["x": $0.x, "y": $0.y, "width": $0.width, "height": $0.height] as Object as Any } ?? NSNull(),
            "summary": profile.summary, "interests": profile.interests,
            "order": profile.order.map(\.rawValue), "hidden": profile.hidden.map(\.rawValue),
        ]
        o["contacts"] = profile.contacts.map { item($0.id, ["kind": $0.kind.rawValue, "value": $0.value]) }
        o["experience"] = profile.experience.map { item($0.id, ["role": $0.role, "organisation": $0.organisation, "location": $0.location, "start": $0.start, "end": $0.end, "current": $0.current, "details": $0.details]) }
        o["education"] = profile.education.map { item($0.id, ["degree": $0.degree, "school": $0.school, "location": $0.location, "start": $0.start, "end": $0.end, "current": $0.current, "details": $0.details]) }
        o["skills"] = profile.skills.map { item($0.id, ["name": $0.name, "level": $0.level]) }
        o["languages"] = profile.languages.map { item($0.id, ["name": $0.name, "level": $0.level]) }
        o["certificates"] = profile.certificates.map { item($0.id, ["name": $0.name, "issuer": $0.issuer, "date": $0.date]) }
        o["projects"] = profile.projects.map { item($0.id, ["name": $0.name, "link": $0.link, "details": $0.details]) }
        o["references"] = profile.references.map { item($0.id, ["name": $0.name, "role": $0.role, "contact": $0.contact]) }
        o["custom"] = profile.custom.map { item($0.id, ["heading": $0.heading, "body": $0.body]) }
        return o
    }

    static func encode(_ theme: StudioCVTheme) -> Object {
        [
            "layout": theme.layout.rawValue, "accent": theme.accent.map { $0 as Any } ?? NSNull(),
            "headingFont": theme.headingFont.map { $0 as Any } ?? NSNull(), "bodyFont": theme.bodyFont.map { $0 as Any } ?? NSNull(),
            "photoShape": theme.photoShape.rawValue, "skillStyle": theme.skillStyle.rawValue, "paper": theme.paper.rawValue,
            "density": theme.density.rawValue, "language": theme.language,
        ]
    }

    /// The portable `vivepdf-cv` file (`cvToJson`): ids stripped, pretty printed.
    static func fileData(_ state: StudioCVState) -> Data {
        let object: Object = ["format": StudioCVLimits.fileFormat, "version": StudioCVLimits.fileVersion, "profile": encode(state.profile, withIds: false), "theme": encode(state.theme)]
        let data = (try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])) ?? Data()
        return data + Data("\n".utf8)
    }

    /// `cvFromJson`: a CV file, a stored state, or a bare profile object.
    static func state(fromFile data: Data, language: String) -> StudioCVState? {
        guard let parsed = try? JSONSerialization.jsonObject(with: data), let raw = parsed as? Object else { return nil }
        if raw["format"] as? String == StudioCVLimits.fileFormat {
            guard let version = raw["version"] as? NSNumber, StudioJSON.isNumber(version), version.doubleValue <= Double(StudioCVLimits.fileVersion) else { return nil }
            return StudioCVState(profile: profile(raw["profile"]), theme: theme(raw["theme"], language: language))
        }
        if raw["profile"] is Object { return StudioCVState(profile: profile(raw["profile"]), theme: theme(raw["theme"], language: language)) }
        if raw["name"] is String || raw["experience"] is [Any] { return StudioCVState(profile: profile(raw), theme: .standard(language)) }
        return nil
    }

    /// Persistence of the working CV (desktop `localStorage["vivepdf.cvStudio"]`).
    static var storeURL: URL { Workspace.supportFolder("studio").appendingPathComponent("cv-studio.json") }

    static func readStored(language: String) -> StudioCVState? {
        guard let data = try? Data(contentsOf: storeURL), let raw = (try? JSONSerialization.jsonObject(with: data)) as? Object else { return nil }
        return StudioCVState(profile: profile(raw["profile"]), theme: theme(raw["theme"], language: language))
    }

    @discardableResult
    static func writeStored(_ state: StudioCVState) -> Bool {
        let object: Object = ["profile": encode(state.profile, withIds: true), "theme": encode(state.theme)]
        guard let data = try? JSONSerialization.data(withJSONObject: object) else { return false }
        return (try? data.write(to: storeURL, options: .atomic)) != nil
    }

    // MARK: Legacy desktop draft (`vivepdf.cvDraft`)

    static func contactKind(of value: String) -> StudioCVContactKind {
        if value.contains("@") { return .email }
        if value.range(of: "linkedin\\.", options: [.regularExpression, .caseInsensitive]) != nil { return .linkedin }
        if value.range(of: "github\\.", options: [.regularExpression, .caseInsensitive]) != nil { return .github }
        if value.range(of: "^(https?://|www\\.)", options: [.regularExpression, .caseInsensitive]) != nil { return .website }
        if value.range(of: "^[+\\d][\\d\\s().-]{6,}$", options: .regularExpression) != nil { return .phone }
        return .other
    }

    static func fromLegacyDraft(_ data: Data, language: String) -> StudioCVState? {
        guard let stored = (try? JSONSerialization.jsonObject(with: data)) as? Object else { return nil }
        var p = StudioCVProfile()
        p.name = str(stored["name"], 200)
        p.headline = str(stored["headline"], 200)
        p.photo = (stored["photo"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        p.summary = str(stored["summary"])
        p.contacts = str(stored["contacts"]).components(separatedBy: .newlines).map(\.cvTrimmed).filter { !$0.isEmpty }.prefix(StudioCVList.contacts.limit).map { StudioCVContact(kind: contactKind(of: $0), value: $0) }
        func entries(_ value: Any?, _ limit: Int) -> [(String, String, String, String, String, String)] {
            list(value, limit) { item -> (String, String, String, String, String, String) in
                let parts = str(item["period"], 80).components(separatedBy: CharacterSet(charactersIn: "–—-")).map(\.cvTrimmed)
                return (str(item["title"], 200), str(item["organisation"], 200), str(item["location"], 200), parts.first ?? "", parts.count > 1 ? parts[1] : "", str(item["details"]))
            }
        }
        p.experience = entries(stored["experience"], StudioCVList.experience.limit).map { StudioCVExperience(role: $0.0, organisation: $0.1, location: $0.2, start: $0.3, end: $0.4, details: $0.5) }
        p.education = entries(stored["education"], StudioCVList.education.limit).map { StudioCVEducation(degree: $0.0, school: $0.1, location: $0.2, start: $0.3, end: $0.4, details: $0.5) }
        p.skills = str(stored["skills"]).components(separatedBy: CharacterSet(charactersIn: "\n,;")).map(\.cvTrimmed).filter { !$0.isEmpty }.prefix(StudioCVList.skills.limit).map { StudioCVLeveled(name: $0, level: 0) }
        p.languages = str(stored["languages"]).components(separatedBy: .newlines).map(\.cvTrimmed).filter { !$0.isEmpty }.prefix(StudioCVList.languages.limit).map { StudioCVLeveled(name: $0, level: 0) }
        p.custom = list(stored["sections"], StudioCVList.custom.limit) { StudioCVCustom(heading: str($0["heading"], 120), body: str($0["body"])) }
        var theme = StudioCVTheme.standard((stored["language"] as? String).flatMap { AppLocale(rawValue: $0) != nil ? $0 : nil } ?? language)
        let accent = str(stored["accent"])
        if StudioJSON.isColour(accent) { theme.accent = accent.lowercased() }
        if stored["paper"] as? String == "letter" { theme.paper = .letter }
        theme.layout = stored["template"] as? String == "classic" ? .classic : stored["template"] as? String == "compact" ? .compact : .modern
        return StudioCVState(profile: p, theme: theme)
    }

    /// `splitListText`: pasted lists separated by new lines, commas, semicolons, bullets or bars.
    static func splitListText(_ text: String) -> [String] {
        text.components(separatedBy: CharacterSet(charactersIn: "\n\r,;•|"))
            .map { $0.replacingOccurrences(of: "^\\s*[-*–]\\s+", with: "", options: .regularExpression).cvTrimmed }
            .filter { !$0.isEmpty }
    }
}

// MARK: - Sample CV

enum StudioCVSample {
    static func profile(_ t: (String) -> String) -> StudioCVProfile {
        func line(_ key: String) -> String { t("studio.cv.sample.\(key)") }
        var p = StudioCVProfile()
        p.name = line("name")
        p.headline = line("headline")
        p.contacts = [
            StudioCVContact(kind: .email, value: line("email")),
            StudioCVContact(kind: .phone, value: line("phone")),
            StudioCVContact(kind: .location, value: line("location")),
            StudioCVContact(kind: .linkedin, value: line("linkedin")),
        ]
        p.summary = line("summary")
        p.experience = [
            StudioCVExperience(role: line("role1"), organisation: line("company1"), location: line("city1"), start: "2021", end: "", current: true, details: line("details1")),
            StudioCVExperience(role: line("role2"), organisation: line("company2"), location: line("city2"), start: "2018", end: "2021", current: false, details: line("details2")),
        ]
        p.education = [StudioCVEducation(degree: line("degree"), school: line("school"), location: line("city2"), start: "2014", end: "2018", details: line("educationDetails"))]
        let levels = [5, 4, 4, 3, 4]
        p.skills = (1...5).map { StudioCVLeveled(name: line("skill\($0)"), level: levels[$0 - 1]) }
        p.languages = [StudioCVLeveled(name: line("language1"), level: 5), StudioCVLeveled(name: line("language2"), level: 4)]
        p.certificates = [StudioCVCertificate(name: line("certificate"), issuer: line("issuer"), date: "2022")]
        p.interests = line("interests")
        return p
    }
}

// MARK: - Import merge (`cvImport.ts`)

enum StudioCVImportKey: String, CaseIterable, Identifiable {
    case personal, contact, summary, experience, education, skills, languages, certificates, projects, references, interests, custom
    var id: String { rawValue }
}

enum StudioCVImportMode { case replace, add }

enum StudioCVImportMerge {
    static func counts(_ p: StudioCVProfile) -> [StudioCVImportKey: Int] {
        [
            .personal: [p.name, p.headline].filter { !$0.cvTrimmed.isEmpty }.count,
            .contact: p.contacts.count, .summary: p.summary.cvTrimmed.isEmpty ? 0 : 1,
            .experience: p.experience.count, .education: p.education.count, .skills: p.skills.count, .languages: p.languages.count,
            .certificates: p.certificates.count, .projects: p.projects.count, .references: p.references.count,
            .interests: p.interests.cvTrimmed.isEmpty ? 0 : 1, .custom: p.custom.count,
        ]
    }

    private static func pick(_ current: String, _ incoming: String, _ mode: StudioCVImportMode) -> String {
        if incoming.cvTrimmed.isEmpty { return current }
        return mode == .replace || current.cvTrimmed.isEmpty ? incoming : current
    }

    private static func join(_ current: String, _ incoming: String, _ separator: String) -> String {
        if incoming.cvTrimmed.isEmpty { return current }
        if current.cvTrimmed.isEmpty { return incoming }
        return current + separator + incoming
    }

    private static func merged<T>(_ current: [T], _ incoming: [T], _ mode: StudioCVImportMode, _ limit: Int, filled: (T) -> Bool) -> [T] {
        guard !incoming.isEmpty else { return current }
        let kept = mode == .replace ? [] : current.filter(filled)
        return Array((kept + incoming).prefix(limit))
    }

    static func apply(_ current: StudioCVProfile, incoming: StudioCVProfile, keys: Set<StudioCVImportKey>, mode: StudioCVImportMode) -> StudioCVProfile {
        var next = current
        if keys.contains(.personal) {
            next.name = pick(current.name, incoming.name, mode)
            next.headline = pick(current.headline, incoming.headline, mode)
        }
        if keys.contains(.summary) { next.summary = mode == .replace ? pick(current.summary, incoming.summary, mode) : join(current.summary, incoming.summary, "\n\n") }
        if keys.contains(.interests) { next.interests = mode == .replace ? pick(current.interests, incoming.interests, mode) : join(current.interests, incoming.interests, ", ") }
        func any(_ values: [String]) -> Bool { values.contains { !$0.cvTrimmed.isEmpty } }
        if keys.contains(.contact) { next.contacts = merged(current.contacts, incoming.contacts, mode, StudioCVList.contacts.limit) { any([$0.value]) } }
        if keys.contains(.experience) { next.experience = merged(current.experience, incoming.experience, mode, StudioCVList.experience.limit) { any([$0.role, $0.organisation, $0.location, $0.start, $0.end, $0.details]) } }
        if keys.contains(.education) { next.education = merged(current.education, incoming.education, mode, StudioCVList.education.limit) { any([$0.degree, $0.school, $0.location, $0.start, $0.end, $0.details]) } }
        if keys.contains(.skills) { next.skills = merged(current.skills, incoming.skills, mode, StudioCVList.skills.limit) { any([$0.name]) } }
        if keys.contains(.languages) { next.languages = merged(current.languages, incoming.languages, mode, StudioCVList.languages.limit) { any([$0.name]) } }
        if keys.contains(.certificates) { next.certificates = merged(current.certificates, incoming.certificates, mode, StudioCVList.certificates.limit) { any([$0.name, $0.issuer, $0.date]) } }
        if keys.contains(.projects) { next.projects = merged(current.projects, incoming.projects, mode, StudioCVList.projects.limit) { any([$0.name, $0.link, $0.details]) } }
        if keys.contains(.references) { next.references = merged(current.references, incoming.references, mode, StudioCVList.references.limit) { any([$0.name, $0.role, $0.contact]) } }
        if keys.contains(.custom) { next.custom = merged(current.custom, incoming.custom, mode, StudioCVList.custom.limit) { any([$0.heading, $0.body]) } }
        next.hidden = current.hidden.filter { section in !keys.contains { $0.rawValue == section.rawValue } }
        return next
    }
}
