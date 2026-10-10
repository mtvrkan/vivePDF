import Foundation

/// Options for a full rewrite (`CosDocument.write(_:)`).
struct CosWriteOptions {
    enum Encryption {
        /// Keep the source file's encryption (same key and /Encrypt dictionary); none if it had none.
        case preserve
        /// Write unencrypted.
        case none
        /// Password encryption with the Standard handler.
        case standard(CosStandardSecurity.Settings)
        /// Caller-built handler (public-key security, custom /Encrypt dictionaries).
        case custom(CosCryptHandler)
    }

    var encryption: Encryption = .preserve
    /// Drop objects unreachable from the trailer and renumber 1…n. When false, live objects keep their numbers.
    var garbageCollect = true
    /// Pack non-stream objects into object streams and write an xref stream (PDF 1.5+; much smaller files).
    var useObjectStreams = false
    /// Flate-compress streams that have no filter (XMP metadata stays uncompressed for PDF/A).
    var compressStreams = true
    /// Decode and re-compress plain FlateDecode streams (slow; rarely smaller).
    var recompressFlate = false
    /// Header version override; by default the source version, raised as needed by the features used.
    var version: String?
    /// Regenerate the second /ID element (the first is kept; it identifies the document).
    var refreshDocumentID = true
    /// Reserve a signature /Contents placeholder in this signature dictionary (see `CosSignaturePlaceholder`).
    var signature: CosSignaturePlaceholder?

    init(encryption: Encryption = .preserve, garbageCollect: Bool = true, useObjectStreams: Bool = false,
         compressStreams: Bool = true, recompressFlate: Bool = false, version: String? = nil,
         refreshDocumentID: Bool = true, signature: CosSignaturePlaceholder? = nil) {
        self.encryption = encryption
        self.garbageCollect = garbageCollect
        self.useObjectStreams = useObjectStreams
        self.compressStreams = compressStreams
        self.recompressFlate = recompressFlate
        self.version = version
        self.refreshDocumentID = refreshDocumentID
        self.signature = signature
    }
}

/// Requests a signature placeholder: the dictionary at `signatureRef` is written with a fixed-width
/// `/ByteRange` and a zero-filled `/Contents <…>` of `contentsCapacity` bytes (hex doubles it).
struct CosSignaturePlaceholder {
    var signatureRef: CosRef
    var contentsCapacity: Int

    init(signatureRef: CosRef, contentsCapacity: Int = 16384) {
        self.signatureRef = signatureRef
        self.contentsCapacity = contentsCapacity
    }
}

/// Output of a write with a signature placeholder. `/ByteRange` is already patched; compute the digest
/// over `signedBytes` and call `embedding(cms:)`.
struct CosPreparedSignature {
    var data: Data
    /// [0, a, b, c] as written in /ByteRange.
    var byteRange: [Int]
    /// Byte range of the `<…>` hex string (brackets included) — the part excluded from the digest.
    var contentsRange: Range<Int>

    /// The bytes covered by /ByteRange (everything except the /Contents hex string).
    var signedBytes: Data {
        var d = Data(data[data.startIndex..<data.startIndex + byteRange[1]])
        d.append(data[(data.startIndex + byteRange[2])..<(data.startIndex + byteRange[2] + byteRange[3])])
        return d
    }

    /// Patches the DER-encoded CMS into the placeholder (zero-padded). Throws when it does not fit.
    func embedding(cms: Data) throws -> Data {
        let capacity = (contentsRange.count - 2) / 2
        guard cms.count <= capacity else { throw CosError.writeFailed("signature is \(cms.count) bytes, placeholder holds \(capacity)") }
        var out = data
        var hex = [UInt8]()
        CosSerializer.writeHex([UInt8](cms), into: &hex)
        hex.removeFirst(); hex.removeLast()
        let start = out.startIndex + contentsRange.lowerBound + 1
        out.replaceSubrange(start..<start + hex.count, with: hex)
        return out
    }
}

/// Accumulates output and tracks offsets.
private struct CosOutput {
    var data = Data()
    var offset: Int { data.count }
    mutating func append(_ bytes: [UInt8]) { data.append(contentsOf: bytes) }
    mutating func append(_ d: Data) { data.append(d) }
    mutating func append(_ s: String) { data.append(contentsOf: Array(s.utf8)) }
}

extension CosDocument {
    // MARK: Full rewrite

    /// Writes a complete new file. Throws `.passwordRequired` for locked documents.
    func write(_ options: CosWriteOptions = CosWriteOptions()) throws -> Data {
        try writeFull(options).data
    }

    /// Full rewrite with a signature placeholder (`options.signature` must be set).
    func writePreparingSignature(_ options: CosWriteOptions) throws -> CosPreparedSignature {
        let result = try writeFull(options)
        guard let prepared = result.signature else { throw CosError.invalidArgument("signature placeholder missing") }
        return prepared
    }

    /// Writes the full rewrite straight to a file (atomically).
    func write(to url: URL, options: CosWriteOptions = CosWriteOptions()) throws {
        try write(options).write(to: url, options: .atomic)
    }

    private func writeFull(_ options: CosWriteOptions) throws -> (data: Data, signature: CosPreparedSignature?) {
        lock.lock(); defer { lock.unlock() }
        guard !isLocked else { throw CosError.passwordRequired }

        // Document ID (first element identifies the document; legacy encryption keys depend on it).
        let oldID = documentID
        let id0 = oldID?.first?.bytes ?? CosCrypto.randomBytes(16)
        let id1 = options.refreshDocumentID || oldID == nil || oldID!.count < 2 ? CosCrypto.randomBytes(16) : oldID![1].bytes

        let outCrypt: CosCryptHandler?
        switch options.encryption {
        case .none: outCrypt = nil
        case .preserve: outCrypt = crypt
        case .standard(let settings): outCrypt = CosStandardSecurity.makeHandler(settings, documentID: id0)
        case .custom(let handler): outCrypt = handler
        }

        // Collect objects and assign numbers.
        let t = trailer
        var roots: [CosObject] = []
        if let root = t["Root"] { roots.append(root) }
        if let info = t["Info"] { roots.append(info) }
        var numbering: [Int: Int] = [:] // old object number → new number
        var order: [CosRef] = []
        if options.garbageCollect {
            var queue = roots.compactMap { $0.ref }
            var head = 0
            var seen = Set<Int>()
            while head < queue.count {
                let r = queue[head]
                head += 1
                guard !seen.contains(r.num), exists(r) else { continue }
                seen.insert(r.num)
                order.append(r)
                numbering[r.num] = order.count
                collectRefs(object(r)) { queue.append($0) }
            }
        } else {
            for r in allRefs {
                order.append(r)
                numbering[r.num] = r.num
            }
        }
        var next = (order.isEmpty ? 0 : (options.garbageCollect ? order.count : (order.map(\.num).max() ?? 0))) + 1
        let generations = Dictionary(order.map { ($0.num, $0.gen) }, uniquingKeysWith: { a, _ in a })
        func mapRef(_ r: CosRef) -> CosRef? {
            // References are matched by number (generation mismatches are common and harmless).
            guard let n = numbering[r.num] else { return nil }
            return CosRef(n, options.garbageCollect ? 0 : generations[r.num] ?? 0)
        }
        let numberToRef = Dictionary(order.map { (numbering[$0.num]!, $0) }, uniquingKeysWith: { a, _ in a })

        let signatureNum = options.signature.flatMap { mapRef($0.signatureRef)?.num }
        // Catalog and Info stay outside object streams: CoreGraphics cannot open encrypted files otherwise,
        // and some readers look at them before parsing object streams.
        let directNums = Set([t["Root"], t["Info"]].compactMap { $0?.ref }.compactMap { mapRef($0)?.num })

        // Version.
        var version = options.version ?? headerVersion
        func atLeast(_ v: String) { if CosDocument.compareVersions(version, v) < 0 { version = v } }
        if options.version == nil {
            if options.useObjectStreams { atLeast("1.5") }
            switch outCrypt?.streamMethod {
            case .aesV2?: atLeast("1.6")
            case .aesV3?: atLeast("1.7")
            default: break
            }
            if outCrypt != nil, outCrypt!.revision >= 3 { atLeast("1.4") }
        }

        var out = CosOutput()
        out.append("%PDF-\(version)\n")
        out.append([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A])

        var offsets: [Int: (offset: Int, gen: Int)] = [:]
        var compressed: [Int: (stream: Int, index: Int)] = [:]
        var pendingObjStm: [(num: Int, bytes: [UInt8])] = []
        var prepared: (contentsStart: Int, contentsEnd: Int, byteRangeStart: Int)?

        let serializer = CosSerializer(mapRef: mapRef)

        func flushObjStm() {
            guard !pendingObjStm.isEmpty else { return }
            let streamNum = next
            next += 1
            var header = [UInt8]()
            var body = [UInt8]()
            for (i, item) in pendingObjStm.enumerated() {
                header += Array("\(item.num) \(body.count) ".utf8)
                body += item.bytes
                body.append(0x0A)
                compressed[item.num] = (streamNum, i)
            }
            header.append(0x0A)
            var stream = CosStream(dict: ["Type": "ObjStm", "N": .int(pendingObjStm.count), "First": .int(header.count)],
                                   decoded: Data(header + body), compress: true)
            if let outCrypt { stream.rawData = outCrypt.encryptStream(stream.rawData, dict: stream.dict, CosRef(streamNum)) }
            stream.dict["Length"] = .int(stream.rawData.count)
            offsets[streamNum] = (out.offset, 0)
            out.append("\(streamNum) 0 obj\n")
            var dictBytes = [UInt8]()
            serializer.write(stream.dict, into: &dictBytes)
            out.append(dictBytes)
            out.append("\nstream\n")
            out.append(stream.rawData)
            out.append("\nendstream\nendobj\n")
            pendingObjStm.removeAll()
        }

        for newNum in numberToRef.keys.sorted() {
            let oldRef = numberToRef[newNum]!
            let newRef = CosRef(newNum, options.garbageCollect ? 0 : oldRef.gen)
            var obj = object(oldRef)
            let isSignature = newNum == signatureNum
            if case .stream(var s) = obj {
                s = prepareStream(s, options: options)
                if let outCrypt {
                    s.dict = encryptStrings(in: .dict(s.dict), ref: newRef, crypt: outCrypt).dict ?? s.dict
                    s.rawData = outCrypt.encryptStream(s.rawData, dict: s.dict, newRef)
                }
                s.dict["Length"] = .int(s.rawData.count)
                offsets[newNum] = (out.offset, newRef.gen)
                out.append("\(newNum) \(newRef.gen) obj\n")
                var bytes = [UInt8]()
                serializer.write(s.dict, into: &bytes)
                out.append(bytes)
                out.append("\nstream\n")
                out.append(s.rawData)
                out.append("\nendstream\nendobj\n")
                continue
            }
            if options.useObjectStreams, !isSignature, newRef.gen == 0, !directNums.contains(newNum) {
                var bytes = [UInt8]()
                serializer.write(obj, into: &bytes)
                pendingObjStm.append((newNum, bytes))
                if pendingObjStm.count >= 100 { flushObjStm() }
                continue
            }
            if let outCrypt { obj = encryptStrings(in: obj, ref: newRef, crypt: outCrypt) }
            offsets[newNum] = (out.offset, newRef.gen)
            out.append("\(newNum) \(newRef.gen) obj\n")
            if isSignature, let placeholder = options.signature, case .dict(let d) = obj {
                let (bytes, contentsAt, byteRangeAt) = signatureDictBytes(d, serializer: serializer, capacity: placeholder.contentsCapacity)
                let base = out.offset
                out.append(bytes)
                prepared = (base + contentsAt.lowerBound, base + contentsAt.upperBound, base + byteRangeAt)
            } else {
                var bytes = [UInt8]()
                serializer.write(obj, into: &bytes)
                out.append(bytes)
            }
            out.append("\nendobj\n")
        }
        flushObjStm()

        var newTrailer = CosDict()
        if let root = t["Root"], let r = root.ref, let m = mapRef(r) { newTrailer["Root"] = .ref(m) }
        if let info = t["Info"], let r = info.ref, let m = mapRef(r) { newTrailer["Info"] = .ref(m) }
        // Direct /Encrypt: CoreGraphics cannot open xref-stream files whose /Encrypt is indirect.
        if let outCrypt { newTrailer["Encrypt"] = .dict(outCrypt.encryptDictionary) }
        newTrailer["ID"] = [.string(CosString(bytes: id0, isHex: true)), .string(CosString(bytes: id1, isHex: true))]

        if options.useObjectStreams {
            writeXrefStream(&out, offsets: offsets, compressed: compressed, trailer: newTrailer, prev: nil, next: &next, fullTable: true)
        } else {
            writeXrefTable(&out, offsets: offsets, freed: [:], trailer: newTrailer, prev: nil, size: next, fullTable: true)
        }

        var data = out.data
        var signature: CosPreparedSignature?
        if let prepared {
            signature = try patchByteRange(&data, contentsStart: prepared.contentsStart, contentsEnd: prepared.contentsEnd,
                                           byteRangeStart: prepared.byteRangeStart)
        }
        return (data, signature)
    }

    // MARK: Incremental update

    /// Appends the edits (changed/added/deleted objects and trailer changes) to the original bytes as an
    /// incremental update with /Prev. Required for keeping existing signatures valid.
    func writeIncremental() throws -> Data {
        try writeIncrementalImpl(signature: nil).data
    }

    /// Incremental update reserving a signature placeholder in the (changed or added) signature dictionary.
    func writeIncrementalPreparingSignature(_ placeholder: CosSignaturePlaceholder) throws -> CosPreparedSignature {
        let result = try writeIncrementalImpl(signature: placeholder)
        guard let prepared = result.signature else { throw CosError.invalidArgument("signature dictionary \(placeholder.signatureRef) was not changed/added") }
        return prepared
    }

    private func writeIncrementalImpl(signature: CosSignaturePlaceholder?) throws -> (data: Data, signature: CosPreparedSignature?) {
        lock.lock(); defer { lock.unlock() }
        guard !isLocked else { throw CosError.passwordRequired }
        guard byteCount > 0 else { throw CosError.invalidArgument("incremental update needs an existing file") }
        var out = CosOutput()
        out.data = Data(bytes: bytes, count: byteCount)
        if let last = out.data.last, last != 0x0A, last != 0x0D { out.append("\n") }

        var offsets: [Int: (offset: Int, gen: Int)] = [:]
        var freed: [Int: Int] = [:]
        var prepared: (contentsStart: Int, contentsEnd: Int, byteRangeStart: Int)?
        let serializer = CosSerializer()
        for num in changes.keys.sorted() {
            let change = changes[num]!
            let ref = CosRef(num, change.gen)
            guard var obj = change.object else { freed[num] = change.gen + 1; continue }
            if case .stream(var s) = obj {
                if let crypt {
                    s.dict = encryptStrings(in: .dict(s.dict), ref: ref, crypt: crypt).dict ?? s.dict
                    s.rawData = crypt.encryptStream(s.rawData, dict: s.dict, ref)
                }
                s.dict["Length"] = .int(s.rawData.count)
                offsets[num] = (out.offset, ref.gen)
                out.append("\(num) \(ref.gen) obj\n")
                var bytes = [UInt8]()
                serializer.write(s.dict, into: &bytes)
                out.append(bytes)
                out.append("\nstream\n")
                out.append(s.rawData)
                out.append("\nendstream\nendobj\n")
                continue
            }
            if let crypt { obj = encryptStrings(in: obj, ref: ref, crypt: crypt) }
            offsets[num] = (out.offset, ref.gen)
            out.append("\(num) \(ref.gen) obj\n")
            if let signature, signature.signatureRef.num == num, case .dict(let d) = obj {
                let (bytes, contentsAt, byteRangeAt) = signatureDictBytes(d, serializer: serializer, capacity: signature.contentsCapacity)
                let base = out.offset
                out.append(bytes)
                prepared = (base + contentsAt.lowerBound, base + contentsAt.upperBound, base + byteRangeAt)
            } else {
                var bytes = [UInt8]()
                serializer.write(obj, into: &bytes)
                out.append(bytes)
            }
            out.append("\nendobj\n")
        }

        var newTrailer = trailer
        for key in ["Prev", "XRefStm", "Size", "Type", "W", "Index", "Length", "Filter", "DecodeParms"] { newTrailer[key] = nil }
        var next = size
        if wasRepaired || startXref == nil {
            // No trustworthy previous xref: write a complete table covering every live object.
            for (num, entry) in xref where offsets[num] == nil && freed[num] == nil && changes[num] == nil {
                switch entry {
                case .offset(let off, let gen): offsets[num] = (off, gen)
                default: break
                }
            }
            var compressedEntries: [Int: (stream: Int, index: Int)] = [:]
            for (num, entry) in xref where offsets[num] == nil && freed[num] == nil && changes[num] == nil {
                if case .compressed(let s, let i) = entry { compressedEntries[num] = (s, i) }
            }
            writeXrefStream(&out, offsets: offsets, compressed: compressedEntries, trailer: newTrailer, prev: nil, next: &next,
                            fullTable: true, freed: freed)
        } else if xrefKind == .stream {
            writeXrefStream(&out, offsets: offsets, compressed: [:], trailer: newTrailer, prev: startXref, next: &next,
                            fullTable: false, freed: freed)
        } else {
            writeXrefTable(&out, offsets: offsets, freed: freed, trailer: newTrailer, prev: startXref, size: next, fullTable: false)
        }
        var data = out.data
        var result: CosPreparedSignature?
        if let prepared {
            result = try patchByteRange(&data, contentsStart: prepared.contentsStart, contentsEnd: prepared.contentsEnd,
                                        byteRangeStart: prepared.byteRangeStart)
        }
        return (data, result)
    }

    // MARK: Helpers

    private func collectRefs(_ object: CosObject, _ visit: (CosRef) -> Void) {
        switch object {
        case .ref(let r): visit(r)
        case .array(let items): for item in items { collectRefs(item, visit) }
        case .dict(let d): for (_, v) in d { collectRefs(v, visit) }
        case .stream(let s): for (_, v) in s.dict { collectRefs(v, visit) }
        default: break
        }
    }

    private func prepareStream(_ stream: CosStream, options: CosWriteOptions) -> CosStream {
        var s = stream
        let filters = s.filters
        let isMetadata = s.dict.type == "Metadata"
        if options.compressStreams, filters.isEmpty, !isMetadata, s.rawData.count > 64 {
            s.setDecodedData(s.rawData, compress: true)
        } else if options.recompressFlate, filters == ["FlateDecode"], s.dict["DecodeParms"] == nil,
                  let decoded = try? s.decoded() {
            let packed = CosFilters.flateEncode(decoded)
            if packed.count < s.rawData.count { s.setEncodedData(packed, filter: "FlateDecode") }
        }
        // /Length is rewritten; /DL (decoded length) stays valid.
        return s
    }

    /// Encrypts every string inside `object` (signature /Contents excepted).
    func encryptStrings(in object: CosObject, ref: CosRef, crypt: CosCryptHandler) -> CosObject {
        switch object {
        case .string(let s): return .string(CosString(bytes: crypt.encryptString(s.bytes, ref), isHex: true))
        case .array(let items): return .array(items.map { encryptStrings(in: $0, ref: ref, crypt: crypt) })
        case .dict(let d):
            let isSig = CosDocument.isSignatureDict(d)
            var out = CosDict()
            for (k, v) in d { out[k] = isSig && k == "Contents" ? v : encryptStrings(in: v, ref: ref, crypt: crypt) }
            return .dict(out)
        default: return object
        }
    }

    private static let byteRangePlaceholder = "/ByteRange [0 0000000000 0000000000 0000000000]"

    /// Serialises a signature dictionary with placeholder /ByteRange and /Contents. Returns the bytes,
    /// the range of the `<…>` contents and the offset of the `[` of /ByteRange.
    private func signatureDictBytes(_ dict: CosDict, serializer: CosSerializer, capacity: Int) -> ([UInt8], Range<Int>, Int) {
        var d = dict
        d["ByteRange"] = nil
        d["Contents"] = nil
        var bytes = [UInt8]()
        serializer.write(d, into: &bytes)
        bytes.removeLast(2) // ">>"
        let byteRangeAt = bytes.count + "/ByteRange ".utf8.count
        bytes += Array(Self.byteRangePlaceholder.utf8)
        bytes += Array("/Contents ".utf8)
        let contentsStart = bytes.count
        bytes.append(0x3C)
        bytes += [UInt8](repeating: 0x30, count: capacity * 2)
        bytes.append(0x3E)
        let contentsEnd = bytes.count
        bytes += [0x3E, 0x3E]
        return (bytes, contentsStart..<contentsEnd, byteRangeAt)
    }

    private func patchByteRange(_ data: inout Data, contentsStart: Int, contentsEnd: Int, byteRangeStart: Int) throws -> CosPreparedSignature {
        let ranges = [0, contentsStart, contentsEnd, data.count - contentsEnd]
        var text = "[\(ranges.map(String.init).joined(separator: " "))]"
        let width = Self.byteRangePlaceholder.utf8.count - "/ByteRange ".utf8.count
        guard text.utf8.count <= width else { throw CosError.writeFailed("byte range too large") }
        text = String(text.dropLast()) + String(repeating: " ", count: width - text.utf8.count) + "]"
        data.replaceSubrange(byteRangeStart..<byteRangeStart + width, with: Array(text.utf8))
        return CosPreparedSignature(data: data, byteRange: ranges, contentsRange: contentsStart..<contentsEnd)
    }

    private func writeXrefTable(_ out: inout CosOutput, offsets: [Int: (offset: Int, gen: Int)], freed: [Int: Int],
                                trailer: CosDict, prev: Int?, size: Int, fullTable: Bool) {
        let xrefOffset = out.offset
        var entries: [Int: String] = [:]
        for (num, e) in offsets { entries[num] = String(format: "%010d %05d n\r\n", e.offset, min(e.gen, 65535)) }
        for (num, gen) in freed { entries[num] = String(format: "%010d %05d f\r\n", 0, min(gen, 65535)) }
        entries[0] = "0000000000 65535 f\r\n"
        if fullTable { for n in 1..<max(size, 1) where entries[n] == nil { entries[n] = "0000000000 00000 f\r\n" } }
        out.append("xref\n")
        let nums = entries.keys.sorted()
        var i = 0
        while i < nums.count {
            var j = i
            while j + 1 < nums.count, nums[j + 1] == nums[j] + 1 { j += 1 }
            out.append("\(nums[i]) \(j - i + 1)\n")
            for k in i...j { out.append(entries[nums[k]]!) }
            i = j + 1
        }
        var t = trailer
        t["Size"] = .int(max(size, (nums.last ?? 0) + 1))
        if let prev { t["Prev"] = .int(prev) }
        out.append("trailer\n")
        var bytes = [UInt8]()
        CosSerializer().write(t, into: &bytes)
        out.append(bytes)
        out.append("\nstartxref\n\(xrefOffset)\n%%EOF\n")
    }

    private func writeXrefStream(_ out: inout CosOutput, offsets: [Int: (offset: Int, gen: Int)],
                                 compressed: [Int: (stream: Int, index: Int)], trailer: CosDict, prev: Int?,
                                 next: inout Int, fullTable: Bool, freed: [Int: Int] = [:]) {
        let xrefNum = next
        next += 1
        let xrefOffset = out.offset
        var rows: [Int: (Int, Int, Int)] = [:]
        for (num, e) in offsets { rows[num] = (1, e.offset, e.gen) }
        for (num, c) in compressed { rows[num] = (2, c.stream, c.index) }
        for (num, gen) in freed { rows[num] = (0, 0, gen) }
        rows[xrefNum] = (1, xrefOffset, 0)
        if fullTable || rows[0] == nil { rows[0] = (0, 0, 65535) }
        if fullTable { for n in 1..<next where rows[n] == nil { rows[n] = (0, 0, 0) } }
        let maxField2 = rows.values.map { $0.1 }.max() ?? 0
        let w2 = max(1, (String(maxField2, radix: 16).count + 1) / 2)
        let maxField3 = rows.values.map { $0.2 }.max() ?? 0
        let w3 = max(1, (String(maxField3, radix: 16).count + 1) / 2)
        let nums = rows.keys.sorted()
        var index: [CosObject] = []
        var body = [UInt8]()
        var i = 0
        while i < nums.count {
            var j = i
            while j + 1 < nums.count, nums[j + 1] == nums[j] + 1 { j += 1 }
            index += [.int(nums[i]), .int(j - i + 1)]
            for k in i...j {
                let r = rows[nums[k]]!
                body.append(UInt8(r.0))
                for s in stride(from: (w2 - 1) * 8, through: 0, by: -8) { body.append(UInt8((r.1 >> s) & 0xFF)) }
                for s in stride(from: (w3 - 1) * 8, through: 0, by: -8) { body.append(UInt8((r.2 >> s) & 0xFF)) }
            }
            i = j + 1
        }
        var d = trailer
        d["Type"] = "XRef"
        d["Size"] = .int(max(next, (nums.last ?? 0) + 1))
        d["W"] = [1, .int(w2), .int(w3)]
        d["Index"] = .array(index)
        if let prev { d["Prev"] = .int(prev) }
        let (packed, parms) = CosFilters.flateEncode(Data(body), pngPredictorColumns: 1 + w2 + w3, colors: 1, bitsPerComponent: 8)
        d["Filter"] = "FlateDecode"
        d["DecodeParms"] = .dict(parms)
        d["Length"] = .int(packed.count)
        out.append("\(xrefNum) 0 obj\n")
        var bytes = [UInt8]()
        CosSerializer().write(d, into: &bytes)
        out.append(bytes)
        out.append("\nstream\n")
        out.append(packed)
        out.append("\nendstream\nendobj\nstartxref\n\(xrefOffset)\n%%EOF\n")
    }
}
