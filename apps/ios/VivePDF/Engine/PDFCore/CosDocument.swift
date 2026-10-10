import Foundation

/// A PDF file at the object level: lazy, memory-mapped parsing (classic xref tables, xref streams, object
/// streams, hybrid files, /Prev chains), automatic repair of broken cross-reference data, decryption, and
/// an edit layer (`update`/`add`/`delete`) that the writer turns into a full rewrite or an incremental update.
///
/// Thread-safety: all methods lock internally, so one document can be read from several tasks.
/// Objects returned are values — edit a copy and store it back with `update(_:_:)`.
final class CosDocument: @unchecked Sendable {
    enum XrefEntry: Equatable {
        case free(gen: Int)
        case offset(Int, gen: Int)
        case compressed(stream: Int, index: Int)

        var isInUse: Bool { if case .free = self { return false }; return true }
        var gen: Int {
            switch self {
            case .free(let g), .offset(_, let g): return g
            case .compressed: return 0
            }
        }
    }

    enum XrefKind { case none, table, stream }

    // Source bytes (memory-mapped for files). Kept alive for zero-copy stream slices.
    let source: NSData
    let bytes: UnsafePointer<UInt8>
    let byteCount: Int
    /// Offset of `%PDF-` (junk before the header shifts all offsets in some files).
    private(set) var headerOffset = 0
    /// Header version ("1.7"); `version` also honours the catalog's /Version.
    private(set) var headerVersion = "1.7"
    /// Offset of the last cross-reference section (`/Prev` for incremental updates); nil for new documents.
    private(set) var startXref: Int?
    private(set) var xrefKind: XrefKind = .none
    /// True when the cross-reference data was rebuilt by scanning the file.
    private(set) var wasRepaired = false

    var xref: [Int: XrefEntry] = [:]
    private var originalTrailer = CosDict()
    private var trailerOverride: CosDict?

    private var cache: [Int: CosObject] = [:]
    private var objStmCache: [Int: [Int: CosObject]] = [:]
    /// Edits: object number → (generation, object; nil = deleted).
    var changes: [Int: (gen: Int, object: CosObject?)] = [:]
    private var nextNumber = 1
    /// Bumped on every edit; lets derived caches (page list) invalidate.
    private(set) var editGeneration = 0
    var pageCache: (generation: Int, refs: [CosRef])?

    let lock = NSRecursiveLock()
    private var loading: Set<Int> = []
    private var repairing = false

    // Security
    private(set) var crypt: CosCryptHandler?
    private(set) var encryptRef: CosRef?
    private(set) var isLocked = false
    private(set) var isOwner = true

    // MARK: Opening

    /// Opens PDF bytes. With `requireUnlock`, encrypted files throw `.passwordRequired` / `.invalidPassword`
    /// unless `password` (or the empty password) opens them. Pass `requireUnlock: false` to inspect a locked
    /// document (e.g. public-key encryption) and call `unlock(password:)` / `unlock(fileKey:)` later.
    init(data: Data, password: String? = nil, requireUnlock: Bool = true) throws {
        source = data as NSData
        let length = source.length
        byteCount = length
        bytes = length > 0 ? source.bytes.assumingMemoryBound(to: UInt8.self) : UnsafePointer(CosDocument.emptyStorage)
        try open(password: password, requireUnlock: requireUnlock)
    }

    /// Opens a file memory-mapped (cheap for very large scans: nothing is read until needed).
    convenience init(url: URL, password: String? = nil, requireUnlock: Bool = true) throws {
        let mapped: Data
        do { mapped = try Data(contentsOf: url, options: .alwaysMapped) } catch { throw CosError.malformed("cannot read file: \(error.localizedDescription)") }
        try self.init(data: mapped, password: password, requireUnlock: requireUnlock)
    }

    /// A new, empty document (catalog + empty page tree).
    init() {
        source = NSData()
        byteCount = 0
        bytes = UnsafePointer(CosDocument.emptyStorage)
        let pagesRef = CosRef(2), catalogRef = CosRef(1)
        changes[1] = (0, .dict(["Type": "Catalog", "Pages": .ref(pagesRef)]))
        changes[2] = (0, .dict(["Type": "Pages", "Kids": [], "Count": 0]))
        nextNumber = 3
        originalTrailer = ["Root": .ref(catalogRef)]
    }

    private static let emptyStorage: UnsafeMutablePointer<UInt8> = {
        let p = UnsafeMutablePointer<UInt8>.allocate(capacity: 1)
        p.initialize(to: 0)
        return p
    }()

    private func open(password: String?, requireUnlock: Bool) throws {
        guard let header = find("%PDF-", from: 0, limit: min(byteCount, 1024)) else {
            // Not a PDF header; still try to recover objects (some files lack a header entirely).
            guard find(" obj", from: 0, limit: min(byteCount, 4096)) != nil else { throw CosError.notAPDF }
            try repair()
            try setUpEncryption(password: password, requireUnlock: requireUnlock)
            return
        }
        headerOffset = header
        var v = ""
        var p = header + 5
        while p < byteCount, p < header + 12, (bytes[p] >= 0x30 && bytes[p] <= 0x39) || bytes[p] == 0x2E {
            v.append(Character(UnicodeScalar(bytes[p])))
            p += 1
        }
        if !v.isEmpty { headerVersion = v }

        do {
            try loadXref()
            guard rootIsValid() else { throw CosError.malformed("missing catalog") }
        } catch {
            try repair()
        }
        nextNumber = max(nextNumber, (xref.keys.max() ?? 0) + 1, (originalTrailer.int("Size") ?? 0))
        try setUpEncryption(password: password, requireUnlock: requireUnlock)
        // A catalog that cannot be read after decryption means the xref was wrong in a subtle way.
        if !isLocked, !rootIsValid(), !wasRepaired {
            try repair()
            try setUpEncryption(password: password, requireUnlock: requireUnlock)
        }
    }

    private func rootIsValid() -> Bool {
        guard let ref = originalTrailer.ref("Root") else { return false }
        guard let d = (try? loadObject(ref.num))?.dict else { return false }
        return d.type == "Catalog" || d["Pages"] != nil
    }

    // MARK: Security

    private func setUpEncryption(password: String?, requireUnlock: Bool) throws {
        guard let encrypt = originalTrailer["Encrypt"] else { return }
        encryptRef = encrypt.ref
        guard let dict = resolveRaw(encrypt).dict else { return }
        crypt = nil
        isLocked = true
        isOwner = false
        let filter = dict.name("Filter") ?? "Standard"
        guard filter == "Standard" else {
            if requireUnlock { throw CosError.unsupportedEncryption(filter) }
            return
        }
        if let password, !password.isEmpty, unlock(password: password) { return }
        if unlock(password: "") { return }
        if requireUnlock { throw (password ?? "").isEmpty ? CosError.passwordRequired : CosError.invalidPassword }
    }

    /// The /Encrypt dictionary (nil when not encrypted).
    var encryptDictionary: CosDict? {
        lock.lock(); defer { lock.unlock() }
        guard let e = originalTrailer["Encrypt"] else { return nil }
        return resolveRaw(e).dict
    }

    var isEncrypted: Bool { encryptDictionary != nil }

    /// Standard-handler method of the source file (nil if not encrypted or not /Standard).
    var encryptionMethod: CosStandardSecurity.Method? { encryptDictionary.flatMap(CosStandardSecurity.method(of:)) }

    /// Permissions granted by the source file's /P (all when unencrypted or opened as owner).
    var permissions: CosPermissions {
        guard let p = encryptDictionary?.int("P") else { return .all }
        return isOwner ? .all : CosPermissions(pValue: p)
    }

    /// Raw /P permissions stored in the file, regardless of how it was opened.
    var storedPermissions: CosPermissions? { encryptDictionary?.int("P").map(CosPermissions.init(pValue:)) }

    /// Tries a password (owner first, then user). Returns true when the document is (now) readable.
    @discardableResult
    func unlock(password: String) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard let dict = encryptDictionary, dict.name("Filter") ?? "Standard" == "Standard" else { return !isLocked }
        let id0 = documentID?.first?.bytes ?? []
        guard let auth = CosStandardSecurity.authenticate(dict, documentID: id0, password: password) else { return !isLocked }
        install(CosCryptHandler(encryptDictionary: dict, fileKey: auth.fileKey), owner: auth.isOwner)
        return true
    }

    /// Unlocks with a file key derived elsewhere (public-key security handler).
    func unlock(fileKey: [UInt8], asOwner: Bool = false) {
        lock.lock(); defer { lock.unlock() }
        guard let dict = encryptDictionary else { return }
        install(CosCryptHandler(encryptDictionary: dict, fileKey: fileKey), owner: asOwner)
    }

    private func install(_ handler: CosCryptHandler, owner: Bool) {
        let wasLocked = isLocked
        crypt = handler
        isLocked = false
        isOwner = owner || (isOwner && !wasLocked)
        if wasLocked {
            cache.removeAll()
            objStmCache.removeAll()
            pageCache = nil
        }
    }

    // MARK: Trailer & identity

    /// Current trailer (original merged trailer plus edits via `setTrailer`). Keys: Root, Info, ID, Encrypt, Size.
    var trailer: CosDict {
        lock.lock(); defer { lock.unlock() }
        return trailerOverride ?? originalTrailer
    }

    /// Changes a trailer entry (e.g. "Info"). Use `nil` to remove.
    func setTrailer(_ key: String, _ value: CosObject?) {
        lock.lock(); defer { lock.unlock() }
        var t = trailerOverride ?? originalTrailer
        t[key] = value
        trailerOverride = t
        editGeneration += 1
    }

    /// True when the trailer was edited (incremental updates then rewrite it).
    var trailerChanged: Bool { trailerOverride != nil }

    var catalogRef: CosRef? { trailer.ref("Root") }

    /// The resolved document catalog (empty when unreadable).
    var catalog: CosDict { dict(trailer["Root"]) ?? CosDict() }

    /// `/ID` array (two byte strings) if present.
    var documentID: [CosString]? {
        guard let a = resolveRaw(trailer["ID"]).array else { return nil }
        let strings = a.compactMap { resolveRaw($0).string }
        return strings.isEmpty ? nil : strings
    }

    /// Effective PDF version: max of header and catalog /Version.
    var version: String {
        if let v = catalog.name("Version"), CosDocument.compareVersions(v, headerVersion) > 0 { return v }
        return headerVersion
    }

    static func compareVersions(_ a: String, _ b: String) -> Int {
        let pa = a.split(separator: ".").compactMap { Int($0) }, pb = b.split(separator: ".").compactMap { Int($0) }
        for i in 0..<max(pa.count, pb.count) {
            let x = i < pa.count ? pa[i] : 0, y = i < pb.count ? pb[i] : 0
            if x != y { return x < y ? -1 : 1 }
        }
        return 0
    }

    /// Original file bytes (for incremental updates and signature verification).
    var originalData: Data { source as Data }

    // MARK: Object access

    /// Loads an object (edits included). Missing objects are `.null` (as the spec requires).
    func object(_ ref: CosRef) -> CosObject {
        lock.lock(); defer { lock.unlock() }
        if let change = changes[ref.num] { return change.object ?? .null }
        return (try? loadObject(ref.num)) ?? .null
    }

    /// Follows references (chains included) to a direct object.
    func resolve(_ object: CosObject?) -> CosObject {
        var current = object ?? .null
        var hops = 0
        while case .ref(let r) = current, hops < 32 {
            current = self.object(r)
            hops += 1
        }
        return current
    }

    func dict(_ object: CosObject?) -> CosDict? { resolve(object).dict }
    func array(_ object: CosObject?) -> [CosObject]? { resolve(object).array }
    func stream(_ object: CosObject?) -> CosStream? { resolve(object).stream }
    func int(_ object: CosObject?) -> Int? { resolve(object).int }
    func number(_ object: CosObject?) -> Double? { resolve(object).number }
    func name(_ object: CosObject?) -> String? { resolve(object).name }
    func text(_ object: CosObject?) -> String? { resolve(object).text }
    func rect(_ object: CosObject?) -> CGRect? {
        guard let a = array(object) else { return nil }
        return CosObject.array(a.map { resolve($0) }).rect
    }

    /// Decoded stream payload (indirect /Filter or /DecodeParms resolved).
    func decodedData(_ object: CosObject?) throws -> Data {
        guard var s = stream(object) else { throw CosError.invalidArgument("not a stream") }
        if case .ref = s.dict["Filter"] { s.dict["Filter"] = resolve(s.dict["Filter"]) }
        if let parms = s.dict["DecodeParms"] {
            let resolved = resolve(parms)
            s.dict["DecodeParms"] = resolved.array.map { .array($0.map { resolve($0) }) } ?? resolved
        }
        return try s.decoded()
    }

    /// Whether an object number currently exists.
    func exists(_ ref: CosRef) -> Bool {
        lock.lock(); defer { lock.unlock() }
        if let change = changes[ref.num] { return change.object != nil }
        return xref[ref.num]?.isInUse ?? false
    }

    /// Every live object reference (source objects not deleted, plus added ones), sorted.
    var allRefs: [CosRef] {
        lock.lock(); defer { lock.unlock() }
        var set: [Int: Int] = [:]
        for (num, entry) in xref where entry.isInUse && num > 0 { set[num] = entry.gen }
        for (num, change) in changes {
            if change.object == nil { set[num] = nil } else { set[num] = change.gen }
        }
        return set.map { CosRef($0.key, $0.value) }.sorted()
    }

    /// Highest object number + 1 (the trailer /Size an update would need).
    var size: Int {
        lock.lock(); defer { lock.unlock() }
        return max(nextNumber, (xref.keys.max() ?? 0) + 1)
    }

    // MARK: Editing

    /// Replaces (or creates) an indirect object.
    func update(_ ref: CosRef, _ object: CosObject) {
        lock.lock(); defer { lock.unlock() }
        changes[ref.num] = (ref.gen, object)
        nextNumber = max(nextNumber, ref.num + 1)
        editGeneration += 1
    }

    /// Adds a new indirect object and returns its reference.
    @discardableResult
    func add(_ object: CosObject) -> CosRef {
        lock.lock(); defer { lock.unlock() }
        let num = max(nextNumber, (xref.keys.max() ?? 0) + 1)
        nextNumber = num + 1
        changes[num] = (0, object)
        editGeneration += 1
        return CosRef(num, 0)
    }

    /// Deletes an object (writers emit a free entry; references to it read as null).
    func delete(_ ref: CosRef) {
        lock.lock(); defer { lock.unlock() }
        changes[ref.num] = (ref.gen, nil)
        editGeneration += 1
    }

    /// Edits a dictionary (or stream dictionary) object in place: `doc.modify(ref) { $0["Key"] = … }`.
    func modifyDict(_ ref: CosRef, _ body: (inout CosDict) -> Void) {
        lock.lock(); defer { lock.unlock() }
        switch object(ref) {
        case .dict(var d): body(&d); update(ref, .dict(d))
        case .stream(var s): body(&s.dict); update(ref, .stream(s))
        default: break
        }
    }

    /// References edited since opening (updated, added or deleted).
    var changedRefs: [CosRef] {
        lock.lock(); defer { lock.unlock() }
        return changes.map { CosRef($0.key, $0.value.gen) }.sorted()
    }

    var hasChanges: Bool { !changes.isEmpty || trailerOverride != nil }

    /// Stores `object` as a new indirect object if it is a stream (streams must be indirect); otherwise
    /// returns it unchanged. Handy when building dictionaries.
    func indirectIfStream(_ object: CosObject) -> CosObject {
        if case .stream = object { return .ref(add(object)) }
        return object
    }

    // MARK: Loading

    /// Loads source object `num` without consulting edits.
    func loadObject(_ num: Int) throws -> CosObject {
        if let cached = cache[num] { return cached }
        guard let entry = xref[num] else { return .null }
        guard !loading.contains(num) else { throw CosError.malformed("reference cycle at \(num)") }
        loading.insert(num)
        defer { loading.remove(num) }
        let object: CosObject
        switch entry {
        case .free: return .null
        case .offset(let offset, let gen):
            do {
                object = try loadIndirect(at: offset, expecting: num, gen: gen)
            } catch {
                // Offsets relative to junk before the header, or a broken xref: try shifting, then repair.
                if headerOffset > 0, let shifted = try? loadIndirect(at: offset + headerOffset, expecting: num, gen: gen) {
                    object = shifted
                } else if !wasRepaired, !repairing {
                    loading.remove(num)
                    try repair()
                    return try loadObject(num)
                } else {
                    throw error
                }
            }
        case .compressed(let streamNum, let index):
            object = try loadCompressed(num, stream: streamNum, index: index)
        }
        cache[num] = object
        return object
    }

    private func loadIndirect(at offset: Int, expecting num: Int, gen: Int) throws -> CosObject {
        guard offset >= 0, offset < byteCount else { throw CosError.malformed("offset out of range") }
        var lexer = CosLexer(base: bytes, count: byteCount, at: offset)
        guard case .int(let n) = lexer.nextToken(), case .int(let g) = lexer.nextToken(),
              case .keyword("obj") = lexer.nextToken() else { throw CosError.malformed("no object at \(offset)") }
        guard n == num else { throw CosError.malformed("object number mismatch at \(offset)") }
        var object = try parseBody(&lexer, ref: CosRef(n, g))
        if let crypt, !isLocked { object = decrypt(object, ref: CosRef(n, g), crypt: crypt) }
        return object
    }

    /// Parses an object after `n g obj`, including stream data.
    private func parseBody(_ lexer: inout CosLexer, ref: CosRef) throws -> CosObject {
        let token = lexer.nextToken()
        if case .keyword("endobj") = token { return .null }
        let object = try lexer.parseObject(after: token)
        guard case .dict(var dict) = object else { return object }
        let save = lexer.pos
        guard lexer.consumeKeyword("stream") else { lexer.pos = save; return object }
        var start = lexer.pos
        // Skip the EOL after `stream` (CRLF or LF; lenient about lone CR and spaces).
        while start < byteCount, bytes[start] == 0x20 { start += 1 }
        if start < byteCount, bytes[start] == 0x0D { start += 1 }
        if start < byteCount, bytes[start] == 0x0A { start += 1 }
        var length = -1
        switch dict["Length"] {
        case .int(let l)?: length = l
        case .ref(let r)?:
            if r.num != ref.num, let l = (changes[r.num]?.object ?? (try? loadObject(r.num)))?.int {
                length = l
                dict["Length"] = .int(l)
            }
        default: break
        }
        if length < 0 || start + length > byteCount || !endstreamFollows(start + length) {
            // Wrong /Length: find `endstream` and trim the EOL before it.
            if let end = find("endstream", from: start, limit: byteCount) {
                var e = end
                if e > start, bytes[e - 1] == 0x0A { e -= 1 }
                if e > start, bytes[e - 1] == 0x0D { e -= 1 }
                length = e - start
            } else {
                length = max(0, byteCount - start)
            }
            dict["Length"] = .int(length)
        }
        // Resolve indirect filter parameters so CosStream can decode on its own.
        if case .ref(let r)? = dict["Filter"] { dict["Filter"] = changes[r.num]?.object ?? (try? loadObject(r.num)) }
        if case .ref(let r)? = dict["DecodeParms"] { dict["DecodeParms"] = changes[r.num]?.object ?? (try? loadObject(r.num)) }
        return .stream(CosStream(dict: dict, rawData: slice(start, length)))
    }

    private func endstreamFollows(_ p: Int) -> Bool {
        var q = p
        while q < byteCount, CosBytes.isWhitespace(bytes[q]) { q += 1 }
        let lexer = CosLexer(base: bytes, count: byteCount, at: q)
        return lexer.matches("endstream", at: q) || lexer.matches("endobj", at: q)
    }

    /// Zero-copy view of the mapped source; the closure keeps the mapping alive.
    private func slice(_ start: Int, _ length: Int) -> Data {
        guard length > 0 else { return Data() }
        if length < 4096 { return Data(bytes: bytes + start, count: length) }
        let owner = source
        return Data(bytesNoCopy: UnsafeMutableRawPointer(mutating: bytes + start), count: length,
                    deallocator: .custom { _, _ in _ = owner })
    }

    private func loadCompressed(_ num: Int, stream streamNum: Int, index: Int) throws -> CosObject {
        if let objects = objStmCache[streamNum] { return objects[num] ?? .null }
        guard let stream = try loadObject(streamNum).stream else { throw CosError.malformed("object stream \(streamNum) missing") }
        let data = try stream.decoded()
        let n = stream.dict.int("N") ?? 0
        let first = stream.dict.int("First") ?? 0
        var objects: [Int: CosObject] = [:]
        data.withCosLexer { lexer in
            var pairs: [(Int, Int)] = []
            for _ in 0..<max(0, min(n, 1_000_000)) {
                guard case .int(let objNum) = lexer.nextToken(), case .int(let off) = lexer.nextToken() else { break }
                pairs.append((objNum, off))
            }
            for (objNum, off) in pairs {
                // Only members the xref still points at this stream (later updates may supersede them).
                if case .compressed(let s, _)? = xref[objNum], s == streamNum {} else { continue }
                lexer.pos = first + off
                guard lexer.pos < lexer.count else { continue }
                if let object = try? lexer.parseObject() { objects[objNum] = object }
            }
        }
        objStmCache[streamNum] = objects
        _ = index
        return objects[num] ?? .null
    }

    /// Resolves using raw loading (no edits) — for the encryption dictionary and trailer values.
    private func resolveRaw(_ object: CosObject?) -> CosObject {
        var current = object ?? .null
        var hops = 0
        while case .ref(let r) = current, hops < 8 {
            current = changes[r.num]?.object ?? (try? loadObject(r.num)) ?? .null
            hops += 1
        }
        return current
    }

    private func decrypt(_ object: CosObject, ref: CosRef, crypt: CosCryptHandler) -> CosObject {
        if ref == encryptRef || object.dict?.type == "XRef" { return object }
        switch object {
        case .string(var s):
            s.bytes = crypt.decryptString(s.bytes, ref)
            return .string(s)
        case .array(let items):
            return .array(items.map { decrypt($0, ref: ref, crypt: crypt) })
        case .dict(let d):
            return .dict(decryptDict(d, ref: ref, crypt: crypt))
        case .stream(var s):
            s.dict = decryptDict(s.dict, ref: ref, crypt: crypt)
            s.rawData = crypt.decryptStream(s.rawData, dict: s.dict, ref)
            return .stream(s)
        default:
            return object
        }
    }

    private func decryptDict(_ d: CosDict, ref: CosRef, crypt: CosCryptHandler) -> CosDict {
        let isSignature = CosDocument.isSignatureDict(d)
        var out = CosDict()
        for (key, value) in d {
            if isSignature && key == "Contents" { out[key] = value; continue }
            out[key] = decrypt(value, ref: ref, crypt: crypt)
        }
        return out
    }

    /// Signature dictionaries keep `/Contents` unencrypted (ISO 32000-2 §7.6.2).
    static func isSignatureDict(_ d: CosDict) -> Bool {
        let type = d.type
        if type == "Sig" || type == "DocTimeStamp" { return true }
        return d["ByteRange"] != nil && d["Contents"] != nil && d["Filter"] != nil
    }

    // MARK: Cross-reference loading

    private func loadXref() throws {
        guard let sx = findLast("startxref", within: 4096) else { throw CosError.malformed("no startxref") }
        var lexer = CosLexer(base: bytes, count: byteCount, at: sx + 9)
        guard case .int(let offset) = lexer.nextToken() else { throw CosError.malformed("bad startxref") }
        var queue = [offset]
        var visited = Set<Int>()
        var first = true
        while let rawOffset = queue.popLast() {
            guard !visited.contains(rawOffset) else { continue }
            visited.insert(rawOffset)
            var section: (trailer: CosDict, kind: XrefKind)
            do {
                section = try readXrefSection(at: rawOffset)
            } catch {
                if first, headerOffset > 0, let shifted = try? readXrefSection(at: rawOffset + headerOffset) {
                    section = shifted
                } else if first, let near = nearbyXref(rawOffset), let s = try? readXrefSection(at: near) {
                    section = s
                } else if first {
                    throw error
                } else {
                    break // a broken /Prev: keep what we have (repair runs if the result is unusable)
                }
            }
            if first {
                startXref = offset
                xrefKind = section.kind
                originalTrailer = section.trailer
                first = false
            } else {
                for (k, v) in section.trailer where originalTrailer[k] == nil && k != "Prev" && k != "XRefStm" {
                    originalTrailer[k] = v
                }
            }
            if let prev = section.trailer.int("Prev") { queue.append(prev) }
        }
        originalTrailer["Prev"] = nil
        originalTrailer["XRefStm"] = nil
        if xref.isEmpty { throw CosError.malformed("empty xref") }
    }

    /// Some files point a few bytes off; look for `xref` or `n g obj` around the offset.
    private func nearbyXref(_ offset: Int) -> Int? {
        let lo = max(0, offset - 64)
        if let p = find("xref", from: lo, limit: min(byteCount, offset + 64)) { return p }
        return nil
    }

    private func readXrefSection(at offset: Int) throws -> (trailer: CosDict, kind: XrefKind) {
        guard offset >= 0, offset < byteCount else { throw CosError.malformed("xref offset out of range") }
        var lexer = CosLexer(base: bytes, count: byteCount, at: offset)
        if lexer.consumeKeyword("xref") {
            let entries = try readXrefTable(&lexer)
            guard lexer.consumeKeyword("trailer") else { throw CosError.malformed("no trailer") }
            guard case .dict(let trailer) = try lexer.parseObject() else { throw CosError.malformed("bad trailer") }
            // Hybrid file: the /XRefStm entries fill gaps (and free slots) of this table.
            var streamEntries: [(Int, XrefEntry)] = []
            if let stm = trailer.int("XRefStm"), let parsed = try? readXrefStream(at: stm) {
                streamEntries = parsed.entries
            }
            var sectionMap: [Int: XrefEntry] = [:]
            for (n, e) in entries where sectionMap[n] == nil { sectionMap[n] = e }
            for (n, e) in streamEntries {
                if let existing = sectionMap[n], existing.isInUse { continue }
                sectionMap[n] = e
            }
            merge(sectionMap)
            return (trailer, .table)
        }
        let parsed = try readXrefStream(at: offset)
        var sectionMap: [Int: XrefEntry] = [:]
        for (n, e) in parsed.entries where sectionMap[n] == nil { sectionMap[n] = e }
        merge(sectionMap)
        return (parsed.trailer, .stream)
    }

    /// Older sections never override newer ones.
    private func merge(_ section: [Int: XrefEntry]) {
        for (n, e) in section where xref[n] == nil && n >= 0 && n < 8_388_608 { xref[n] = e }
    }

    private func readXrefTable(_ lexer: inout CosLexer) throws -> [(Int, XrefEntry)] {
        var entries: [(Int, XrefEntry)] = []
        while true {
            let save = lexer.pos
            guard case .int(var start) = lexer.nextToken(), case .int(let count) = lexer.nextToken() else {
                lexer.pos = save
                break
            }
            guard count >= 0, count < 10_000_000 else { throw CosError.malformed("bad xref subsection") }
            for i in 0..<count {
                let entrySave = lexer.pos
                guard case .int(let off) = lexer.nextToken(), case .int(let gen) = lexer.nextToken() else {
                    lexer.pos = entrySave
                    break
                }
                let kind = lexer.nextToken()
                // Classic bug: subsection "1 n" whose first entry is the free head of the list.
                if i == 0, start == 1, off == 0, gen == 65535 { start = 0 }
                let num = start + i
                switch kind {
                case .keyword("n"): entries.append((num, off == 0 && num != 0 ? .free(gen: gen) : .offset(off, gen: gen)))
                case .keyword("f"): entries.append((num, .free(gen: gen)))
                default: throw CosError.malformed("bad xref entry")
                }
            }
        }
        return entries
    }

    private func readXrefStream(at offset: Int) throws -> (trailer: CosDict, entries: [(Int, XrefEntry)]) {
        var lexer = CosLexer(base: bytes, count: byteCount, at: offset)
        guard case .int(let n) = lexer.nextToken(), case .int(let g) = lexer.nextToken(),
              case .keyword("obj") = lexer.nextToken() else { throw CosError.malformed("no xref stream at \(offset)") }
        guard case .stream(let stream) = try parseBody(&lexer, ref: CosRef(n, g)) else { throw CosError.malformed("xref is not a stream") }
        let dict = stream.dict
        let data = [UInt8](try stream.decoded())
        guard let w = dict.array("W")?.compactMap({ $0.int }), w.count >= 3, w.allSatisfy({ $0 >= 0 && $0 <= 8 }) else {
            throw CosError.malformed("bad /W")
        }
        let size = dict.int("Size") ?? 0
        var index = dict.array("Index")?.compactMap { $0.int } ?? [0, size]
        if index.count % 2 != 0 { index = [0, size] }
        let rowSize = w[0] + w[1] + w[2]
        guard rowSize > 0 else { throw CosError.malformed("bad /W") }
        var entries: [(Int, XrefEntry)] = []
        var p = 0
        func field(_ width: Int, default value: Int) -> Int {
            guard width > 0 else { return value }
            var v = 0
            for _ in 0..<width { v = v << 8 | Int(data[p]); p += 1 }
            return v
        }
        var pair = 0
        while pair + 1 < index.count {
            let start = index[pair], count = index[pair + 1]
            pair += 2
            for i in 0..<max(0, count) {
                guard p + rowSize <= data.count else { break }
                let type = field(w[0], default: 1)
                let f2 = field(w[1], default: 0)
                let f3 = field(w[2], default: 0)
                let num = start + i
                switch type {
                case 0: entries.append((num, .free(gen: f3)))
                case 1: entries.append((num, .offset(f2, gen: f3)))
                case 2: entries.append((num, .compressed(stream: f2, index: f3)))
                default: break // unknown types are ignored (spec: treat as null)
                }
            }
        }
        // The xref stream object itself is cached as a regular object if it is in use.
        return (dict, entries)
    }

    // MARK: Repair

    /// Rebuilds the cross-reference table by scanning for `n g obj`, trailers and object streams.
    func repair() throws {
        guard !repairing else { return }
        repairing = true
        defer { repairing = false }
        var found: [Int: XrefEntry] = [:]
        var trailers: [CosDict] = []
        var p = 0
        while let hit = find("obj", from: p, limit: byteCount) {
            p = hit + 3
            if hit + 3 < byteCount, CosBytes.isRegular(bytes[hit + 3]) { continue } // "object", "objstm"…
            // Backtrack over "num gen ".
            var q = hit - 1
            guard q > 0, CosBytes.isWhitespace(bytes[q]) else { continue }
            while q > 0, CosBytes.isWhitespace(bytes[q]) { q -= 1 }
            let genEnd = q + 1
            while q >= 0, bytes[q] >= 0x30, bytes[q] <= 0x39 { q -= 1 }
            let genStart = q + 1
            guard genStart < genEnd, genEnd - genStart <= 5, q > 0, CosBytes.isWhitespace(bytes[q]) else { continue }
            while q > 0, CosBytes.isWhitespace(bytes[q]) { q -= 1 }
            let numEnd = q + 1
            while q >= 0, bytes[q] >= 0x30, bytes[q] <= 0x39 { q -= 1 }
            let numStart = q + 1
            guard numStart < numEnd, numEnd - numStart <= 8 else { continue }
            if q >= 0, CosBytes.isRegular(bytes[q]) { continue }
            var num = 0, gen = 0
            for k in numStart..<numEnd { num = num * 10 + Int(bytes[k] - 0x30) }
            for k in genStart..<genEnd { gen = gen * 10 + Int(bytes[k] - 0x30) }
            found[num] = .offset(numStart, gen: gen) // later definitions win (incremental updates)
        }
        p = 0
        while let hit = find("trailer", from: p, limit: byteCount) {
            p = hit + 7
            var lexer = CosLexer(base: bytes, count: byteCount, at: hit + 7)
            if case .dict(let d)? = try? lexer.parseObject() { trailers.append(d) }
        }
        let previousXref = xref
        xref = found
        cache.removeAll()
        objStmCache.removeAll()
        // Inspect objects for xref streams (trailer data) and object streams (compressed members).
        var catalogs: [Int] = []
        let directNums = found.keys.sorted { a, b in
            if case .offset(let x, _) = found[a]!, case .offset(let y, _) = found[b]! { return x < y }
            return a < b
        }
        for num in directNums {
            guard case .offset(let off, let gen)? = found[num] else { continue }
            var lexer = CosLexer(base: bytes, count: byteCount, at: off)
            _ = lexer.nextToken(); _ = lexer.nextToken(); _ = lexer.nextToken()
            guard let object = try? parseBody(&lexer, ref: CosRef(num, gen)) else { continue }
            let d = object.dict
            switch d?.type {
            case "XRef": if let d { trailers.append(d) }
            case "Catalog": catalogs.append(num)
            case "ObjStm":
                guard let stream = object.stream, let data = try? stream.decoded() else { continue }
                let n = stream.dict.int("N") ?? 0
                data.withCosLexer { lexer in
                    for i in 0..<max(0, min(n, 1_000_000)) {
                        guard case .int(let member) = lexer.nextToken(), case .int = lexer.nextToken() else { break }
                        if found[member] == nil {
                            xref[member] = .compressed(stream: num, index: i)
                        }
                    }
                }
            default: break
            }
        }
        var trailer = CosDict()
        for t in trailers { for (k, v) in t where k != "Prev" && k != "XRefStm" && !["Type", "W", "Index", "Length", "Filter", "DecodeParms"].contains(k) { trailer[k] = v } }
        func isCatalog(_ ref: CosRef?) -> Bool {
            guard let ref, let d = (try? loadObject(ref.num))?.dict else { return false }
            return d.type == "Catalog" || d["Pages"] != nil
        }
        if !isCatalog(trailer.ref("Root")) {
            if let last = catalogs.last {
                trailer["Root"] = .ref(CosRef(last, found[last]?.gen ?? 0))
            } else {
                // Catalog inside an object stream: scan compressed members.
                for (num, entry) in xref.sorted(by: { $0.key > $1.key }) {
                    if case .compressed = entry, (try? loadObject(num))?.dict?.type == "Catalog" {
                        trailer["Root"] = .ref(CosRef(num)); break
                    }
                }
            }
        }
        guard isCatalog(trailer.ref("Root")) else {
            xref = previousXref
            throw CosError.malformed("no document catalog found")
        }
        if trailer["Encrypt"] == nil, let enc = originalTrailer["Encrypt"] { trailer["Encrypt"] = enc }
        trailer["Size"] = .int((xref.keys.max() ?? 0) + 1)
        originalTrailer = trailer
        wasRepaired = true
        xrefKind = .none
        startXref = nil
        nextNumber = max(nextNumber, (xref.keys.max() ?? 0) + 1)
        pageCache = nil
    }

    // MARK: Byte search

    func find(_ needle: StaticString, from: Int, limit: Int) -> Int? {
        let n = needle.utf8CodeUnitCount
        guard from >= 0, limit - from >= n else { return nil }
        guard let hit = memmem(bytes + from, limit - from, needle.utf8Start, n) else { return nil }
        return UnsafeRawPointer(hit) - UnsafeRawPointer(bytes)
    }

    private func findLast(_ needle: StaticString, within window: Int) -> Int? {
        let n = needle.utf8CodeUnitCount
        var start = max(0, byteCount - window)
        var last: Int?
        while let hit = find(needle, from: start, limit: byteCount) {
            last = hit
            start = hit + n
        }
        if last == nil, window < byteCount, window < 1 << 20 { return findLast(needle, within: window * 16) }
        return last
    }
}
