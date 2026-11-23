import { strict as a } from "node:assert";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { crc32, deflateRawSync } from "node:zlib";
import sharp from "sharp";
import { AssetImportError, parse_inputs, preview_image } from "../asset_import.ts";

const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const image = (data: number[] = [11, 42, 90, 0], width = 1, height = 1) =>
  sharp(Buffer.from(data), { raw: { width, height, channels: 4 } }).png().toBuffer();

function chunk(name: string, data: Buffer): Buffer {
  const value = Buffer.concat([Buffer.from(name), data]);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const foot = Buffer.alloc(4);
  foot.writeUInt32BE(crc32(value));
  return Buffer.concat([header, value, foot]);
}

type ZipEntry = { filename: string; data: Buffer; method?: number; flags?: number; attrs?: number; invalidCrc?: boolean; local?: string };
function zip(entries: ZipEntry[]): Buffer {
  const local = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.filename), localName = Buffer.from(e.local ?? e.filename);
    const flags = 0x800 | (e.flags ?? 0);
    const method = e.method ?? 0;
    const data = method === 8 ? deflateRawSync(e.data) : e.data;
    const crc = crc32(e.data) ^ (e.invalidCrc ? 1 : 0);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(flags, 6);
    h.writeUInt16LE(method, 8);
    h.writeUInt32LE(crc >>> 0, 14);
    h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(e.data.length, 22);
    h.writeUInt16LE(localName.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(0x314, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(flags, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt32LE(crc >>> 0, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(e.data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE((e.attrs ?? 0) >>> 0, 38);
    c.writeUInt32LE(offset, 42);
    local.push(h, localName, data);
    central.push(c, name);
    offset += h.length + localName.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, dir, end]);
}

function font(): Buffer {
  const buf = Buffer.alloc(32);
  buf.write("OTTO");
  buf.writeUInt16BE(1, 4);
  buf.write("name", 12);
  buf.writeUInt32BE(28, 20);
  buf.writeUInt32BE(4, 24);
  buf.write("data", 28);
  return buf;
}

test("source identity, RGBA beneath alpha zero, normalization, metadata removal", async () => {
  const first = await image();
  const second = Buffer.concat([first.subarray(0, 33), chunk("tEXt", Buffer.from("Comment\0ignored")), first.subarray(33)]);
  const other = await image([11, 42, 91, 0]);
  const [one, two, three] = await parse_inputs([["one.png", first], ["two.png", second], ["three.png", other]]);
  a.equal(one!.file_hash, sha(first));
  a.notEqual(one!.file_hash, two!.file_hash);
  a.deepEqual(one!.data, two!.data);
  a.notEqual(one!.pixel_hash, three!.pixel_hash);
  a.equal(one!.pixel_hash, sha(Buffer.from([0,0,0,1,0,0,0,1,11,42,90,0])));
  a.equal(one!.data.includes(Buffer.from("pHYs")), false);
});

test("zip directory, ignored metadata and UTF-8 names; font table must fit", async () => {
  const pix = await image();
  const bundle = zip([
    { filename: "folder/", data: Buffer.alloc(0) },
    { filename: "folder/图标.png", data: pix, method: 8 },
    { filename: "__MACOSX/._ignore", data: Buffer.alloc(0) },
    { filename: "a.otf", data: font() },
  ]);
  const rows = await parse_inputs([["bundle.zip", bundle], ["another.png", pix]]);
  a.deepEqual(rows.map(row => row.name), ["图标.png", "a.otf", "another.png"]);
  a.equal(rows[0]!.file_hash, rows[2]!.file_hash);
  a.equal(rows[1]!.pixel_hash, sha(font()));
  await a.rejects(parse_inputs([["invalid.otf", font().subarray(0, 31)]]), AssetImportError);
});

test("reject ZIP unsafe, symlink, encrypted, ratio, nested, mismatched names and bad CRC", async () => {
  const pix = await image();
  const cases: ZipEntry[] = [
    ...["../x.png", "/x.png", "a\\x.png", "a/../x.png", "c:/x.png", "x\0.png", "a.zip", "a.svg"].map(filename => ({ filename, data: pix })),
    { filename: "sym.png", data: pix, attrs: 0xa1ff0000 },
    { filename: "encrypted.png", data: pix, flags: 1 },
    { filename: "ratio.png", data: Buffer.alloc(100_000), method: 8 },
    { filename: "valid.png", local: "local.png", data: pix },
    { filename: "corrupt.png", data: pix, invalidCrc: true },
  ];
  for (const fixture of cases) await a.rejects(parse_inputs([["x.zip", zip([fixture])]]), AssetImportError, fixture.filename);
});

test("reject damaged, mismatched, multiframe and oversized images", async () => {
  const pix = await image();
  const animation = Buffer.alloc(8);
  animation.writeUInt32BE(2, 0);
  const apng = Buffer.concat([pix.subarray(0, 33), chunk("acTL", animation), pix.subarray(33)]);
  const corrupt = Buffer.from(pix);
  corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 1;
  const big = await sharp({ create: { width: 9000, height: 1, channels: 3, background: "red" } }).png().toBuffer();
  await a.rejects(parse_inputs([["wrong.jpg", pix]]), /格式/);
  await a.rejects(parse_inputs([["broken.png", corrupt]]), /损坏/);
  await a.rejects(parse_inputs([["anim.png", apng]]), /多帧/);
  await a.rejects(parse_inputs([["big.png", big]]), /尺寸/);
});

test("orientation, 16-bit grayscale Pillow equivalence, bounded PNG preview", async () => {
  const jpg = await sharp({ create: { width: 12, height: 7, channels: 3, background: "red" } })
    .withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const [turned] = await parse_inputs([["turn.jpg", jpg]]);
  a.deepEqual([turned!.width, turned!.height], [7, 12]);
  const gray16 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACEAAAAAAHTY67AAAAEklEQVR4nGNgYGD4z8TI8J8BAAgQAgLRSveAAAAAAElFTkSuQmCC", "base64");
  const fixture = await sharp({ create: { width: 1500, height: 750, channels: 4, background: "blue" } }).png().toBuffer();
  const meta = await sharp(await preview_image(fixture)).metadata();
  a.deepEqual([meta.width, meta.height, meta.format], [1024, 512, "png"]);
  const small = await sharp(await preview_image(turned!.data)).metadata();
  a.deepEqual([small.width, small.height], [7, 12]);
  const [gray] = await parse_inputs([["gray16.png", gray16]]);
  a.equal(gray!.pixel_hash, "3466610e88a34164bd43b44206136ac096b3ec2547b52638e7744330e67af5a5");
});
