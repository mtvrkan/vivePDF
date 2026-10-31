import { crc32, inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { zipFiles } from "./zip";

type ReadEntry = { name: string; data: Buffer; crc: number };

function readZip(zip: Buffer): ReadEntry[] {
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  let cursor = zip.readUInt32LE(end + 16);
  const entries: ReadEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    expect(zip.readUInt32LE(cursor)).toBe(0x02014b50);
    const method = zip.readUInt16LE(cursor + 10);
    const crc = zip.readUInt32LE(cursor + 16);
    const size = zip.readUInt32LE(cursor + 20);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const local = zip.readUInt32LE(cursor + 42);
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    const start = local + 30 + zip.readUInt16LE(local + 26);
    const body = zip.subarray(start, start + size);
    entries.push({ name, data: method === 8 ? inflateRawSync(body) : Buffer.from(body), crc });
    cursor += 46 + nameLength;
  }
  return entries;
}

describe("zipFiles", () => {
  it("writes entries that read back with their names, bytes and checksums", () => {
    const text = Buffer.from("vivePDF ".repeat(200));
    const binary = Buffer.from([0, 255, 7, 9]);

    const entries = readZip(zipFiles([{ name: "a/viewer.js", data: text }, { name: "a/chunks/x.wasm", data: binary }]));

    expect(entries.map((entry) => entry.name)).toEqual(["a/viewer.js", "a/chunks/x.wasm"]);
    expect(entries[0].data.equals(text)).toBe(true);
    expect(entries[1].data.equals(binary)).toBe(true);
    expect(entries.map((entry) => entry.crc)).toEqual([crc32(text), crc32(binary)]);
  });

  it("keeps non-ASCII names", () => {
    const entries = readZip(zipFiles([{ name: "belgeler/Öğrenci Şartları.md", data: Buffer.from("x") }]));

    expect(entries[0].name).toBe("belgeler/Öğrenci Şartları.md");
  });

  it("writes a valid empty archive", () => {
    const zip = zipFiles([]);

    expect(zip.length).toBe(22);
    expect(readZip(zip)).toEqual([]);
  });
});
