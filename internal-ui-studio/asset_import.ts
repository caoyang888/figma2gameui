/** Decode supported imports in memory, without extracting any archive paths to disk. */
import { createHash } from "node:crypto";
import { once } from "node:events";
import { endianness } from "node:os";
import { posix } from "node:path";
import { TextDecoder } from "node:util";
import { crc32 } from "node:zlib";

import sharp, { type Metadata, type Sharp } from "sharp";
import yauzl from "yauzl";

export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;
export const MAX_ZIP_BYTES = 64 * 1024 * 1024;
export const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
export const MAX_RESULT_BYTES = 64 * 1024 * 1024;
export const MAX_FILES = 256;
export const MAX_ZIP_RATIO = 200;
export const MAX_IMAGE_SIDE = 8192;
export const MAX_IMAGE_PIXELS = 16_000_000;

export class AssetImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetImportError";
  }
}

export type AssetRecord = {
  name: string;
  file_hash: string;
  mime: string;
  data: Buffer;
  width: number;
  height: number;
  pixel_hash: string;
  kind: "image" | "font";
};

const IMAGE_FORMATS = new Map([[".png", "png"], [".jpeg", "jpeg"], [".jpg", "jpeg"], [".webp", "webp"]]);
const FONT_FORMATS = new Map([
  [".ttf", { signature: Buffer.from([0, 1, 0, 0]), mime: "font/ttf" }],
  [".otf", { signature: Buffer.from("OTTO"), mime: "font/otf" }],
]);

function codePointLength(value: string): number {
  return [...value].length;
}

function safeName(name: string, directory = false): string[] {
  if (typeof name !== "string" || !name || name.length > 1536 || codePointLength(name) > 768 ||
      name.includes("\\") || name.includes(":")) {
    throw new AssetImportError("文件名或 ZIP 路径不安全");
  }
  if (/[\x00-\x1f\x7f]/u.test(name)) {
    throw new AssetImportError("文件名含控制字符");
  }
  const parts = (directory && name.endsWith("/") ? name.slice(0, -1) : name).split("/");
  if (parts.some(part => !part || part === "." || part === ".." || part.endsWith(".") ||
      part.endsWith(" ") || codePointLength(part) > 255)) {
    throw new AssetImportError("文件名或 ZIP 路径不安全");
  }
  return parts;
}

function isMacMetadata(parts: readonly string[]): boolean {
  return parts.some(part => part === "__MACOSX" || part === ".DS_Store" || part.startsWith("._"));
}

type RawEntry = yauzl.Entry & { fileNameRaw?: Buffer };
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const lowName = (yauzl as typeof yauzl & {
  getFileNameLowLevel(flag: number, filename: Buffer, extraFields: unknown[], strict: boolean): string;
}).getFileNameLowLevel;

function zipName(entry: RawEntry): { name: string; bytes: Buffer } {
  const bytes = entry.fileNameRaw ?? (Buffer.isBuffer(entry.fileName) ? entry.fileName : null);
  if (bytes === null) throw new Error("ZIP filename bytes missing");
  if (bytes.some(byte => byte < 32 || byte === 127)) {
    throw new AssetImportError("文件名含控制字符");
  }
  // Python zipfile uses the original name, not the optional alternate Unicode
  // path field. This also prevents validated and extracted names from diverging.
  const name = (entry.generalPurposeBitFlag & 0x800) ? utf8.decode(bytes) : lowName(0, bytes, [], true);
  return { name, bytes };
}

function checkLocalHeader(input: Buffer, entry: RawEntry, centralName: Buffer) {
  const start = entry.relativeOffsetOfLocalHeader;
  if (!Number.isSafeInteger(start) || start < 0 || start + 30 > input.length ||
      input.readUInt32LE(start) !== 0x04034b50) {
    throw new Error("Invalid ZIP local header");
  }
  const flags = input.readUInt16LE(start + 6);
  const localNameLength = input.readUInt16LE(start + 26);
  const extraLength = input.readUInt16LE(start + 28);
  const nameEnd = start + 30 + localNameLength;
  if (nameEnd + extraLength + entry.compressedSize > input.length ||
      (flags & 1) || input.readUInt16LE(start + 8) !== entry.compressionMethod ||
      !input.subarray(start + 30, nameEnd).equals(centralName)) {
    throw new Error("Inconsistent ZIP local header");
  }
}

function fromBuffer(data: Buffer): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(data, {
      lazyEntries: true, autoClose: false, decodeStrings: false, validateEntrySizes: true,
    }, (error, archive) => error ? reject(error) : resolve(archive));
  });
}

async function* zipEntries(input: Buffer): AsyncGenerator<[string, Buffer]> {
  let archive: yauzl.ZipFile | undefined;
  try {
    archive = await fromBuffer(input);
    if (archive.entryCount > MAX_FILES) throw new AssetImportError("ZIP 内文件或目录过多");
    let total = 0;
    for (let i = 0; i < archive.entryCount; ++i) {
      const pending = once(archive, "entry");
      archive.readEntry();
      const [entry] = await pending as [RawEntry];
      const { name: path, bytes: rawName } = zipName(entry);
      const directory = path.endsWith("/");
      const parts = safeName(path, directory);
      const fileType = (entry.versionMadeBy >>> 8) === 3 ? (entry.externalFileAttributes >>> 16) & 0xf000 : 0;
      if ((fileType !== 0 && fileType !== 0x8000 && fileType !== 0x4000) ||
          (fileType !== 0 && (fileType === 0x4000) !== directory)) {
        throw new AssetImportError("ZIP 不支持符号链接或特殊文件");
      }
      if (entry.generalPurposeBitFlag & 1) throw new AssetImportError("不支持加密 ZIP");
      if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
        throw new AssetImportError("ZIP 仅支持普通存储和 Deflate 压缩");
      }
      if (entry.uncompressedSize > MAX_ENTRY_BYTES ||
          entry.uncompressedSize > MAX_ZIP_RATIO * Math.max(1, entry.compressedSize)) {
        throw new AssetImportError("ZIP 内存在超大文件或异常压缩比");
      }
      total += entry.uncompressedSize;
      if (total > MAX_ZIP_BYTES) throw new AssetImportError("ZIP 解压后的总大小超限");
      if (directory || isMacMetadata(parts)) continue;
      const name = parts[parts.length - 1]!;
      const suffix = posix.extname(name).toLowerCase();
      if (!IMAGE_FORMATS.has(suffix) && !FONT_FORMATS.has(suffix)) {
        throw new AssetImportError(`ZIP 含不支持的文件类型：${name}`);
      }
      checkLocalHeader(input, entry, rawName);
      const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) =>
        archive!.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream)));
      const chunks: Buffer[] = [];
      let length = 0;
      let checksum = 0;
      for await (const chunk of stream) {
        if (!Buffer.isBuffer(chunk)) throw new Error("Invalid ZIP stream chunk");
        const bytes = chunk;
        length += bytes.length;
        if (length > MAX_ENTRY_BYTES || length > entry.uncompressedSize) {
          throw new AssetImportError("ZIP 文件的实际大小与目录不符");
        }
        checksum = crc32(bytes, checksum);
        chunks.push(bytes);
      }
      if (length !== entry.uncompressedSize) throw new AssetImportError("ZIP 文件的实际大小与目录不符");
      if (checksum !== entry.crc32) throw new Error("ZIP CRC mismatch");
      yield [name, Buffer.concat(chunks, length)];
    }
  } catch (error) {
    if (error instanceof AssetImportError) throw error;
    throw new AssetImportError("无法读取 ZIP 文件");
  } finally {
    archive?.close();
  }
}

function validFont(data: Buffer, signature: Buffer): boolean {
  if (data.length < 28 || !data.subarray(0, 4).equals(signature)) return false;
  const count = data.readUInt16BE(4);
  const firstData = 12 + count * 16;
  if (count < 1 || count > 256 || firstData > data.length) return false;
  const seen = new Set<number>();
  for (let off = 12; off < firstData; off += 16) {
    const tag = data.readUInt32BE(off);
    const offset = data.readUInt32BE(off + 8);
    const length = data.readUInt32BE(off + 12);
    if (seen.has(tag) || offset < firstData || offset + length > data.length) return false;
    seen.add(tag);
  }
  return true;
}

function checkPng(data: Buffer, name: string): { gray16: boolean; transparentGray?: number } {
  const gray16 = data.length > 26 && data[24] === 16 && data[25] === 0;
  let transparentGray: number | undefined;
  let hasAnimation = false;
  let hasFrameControl = false;
  // Validate the original chunks independently: libvips does not necessarily
  // report CRC failures in chunks it doesn't consume, nor does it see APNG.
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!data.subarray(0, 8).equals(signature)) throw new Error("Invalid PNG signature");
  for (let off = 8; off + 12 <= data.length;) {
    const length = data.readUInt32BE(off);
    const end = off + length + 12;
    if (end > data.length || crc32(data.subarray(off + 4, end - 4)) !== data.readUInt32BE(end - 4)) {
      throw new Error("Invalid PNG chunk");
    }
    const kind = data.toString("ascii", off + 4, off + 8);
    if (kind === "acTL" && length === 8) {
      hasAnimation = true;
      if (data.readUInt32BE(off + 8) > 1) throw new AssetImportError(`不支持多帧图片：${name}`);
    }
    if (kind === "fcTL") hasFrameControl = true;
    if (kind === "IDAT" && hasAnimation && !hasFrameControl) {
      // APNG can declare one animation frame plus a distinct default image.
      throw new AssetImportError(`不支持多帧图片：${name}`);
    }
    if (gray16 && kind === "tRNS" && length === 2) transparentGray = data.readUInt16BE(off + 8) & 255;
    if (kind === "IEND" && length === 0) return { gray16, transparentGray };
    off = end;
  }
  throw new Error("PNG end chunk missing");
}

function normalizePngChunks(encoded: Buffer): Buffer {
  // Sharp may add pHYs even for raw RGBA. Match the baseline's metadata-free
  // canonical output, keeping exactly IHDR, all IDATs, and IEND.
  const chunks = [encoded.subarray(0, 8)];
  for (let off = 8; off < encoded.length;) {
    const kind = encoded.toString("ascii", off + 4, off + 8);
    const end = off + encoded.readUInt32BE(off) + 12;
    if (kind === "IHDR" || kind === "IDAT" || kind === "IEND") chunks.push(encoded.subarray(off, end));
    off = end;
  }
  return Buffer.concat(chunks);
}

const littleEndian = endianness() === "LE";
type PngHints = { gray16: boolean; transparentGray?: number };

async function decodedRgba(image: Sharp, metadata: Metadata, pngHints?: PngHints) {
  if (metadata.format === "jpeg" && metadata.space === "cmyk") {
    const { data: raw, info } = await image.autoOrient().pipelineColourspace("cmyk")
      .toColourspace("cmyk").raw().toBuffer({ resolveWithObject: true });
    if (info.channels !== 4 || raw.length !== info.width * info.height * 4) throw new Error("Invalid CMYK");
    // Pillow's CMYK-to-RGB operation rather than libvips' ICC-style transform.
    for (let i = 0; i < raw.length; i += 4) {
      const black = 255 - raw[i + 3]!;
      raw[i] = Math.round((255 - raw[i]!) * black / 255);
      raw[i + 1] = Math.round((255 - raw[i + 1]!) * black / 255);
      raw[i + 2] = Math.round((255 - raw[i + 2]!) * black / 255);
      raw[i + 3] = 255;
    }
    return { data: raw, info: { ...info, channels: 4 } };
  }
  if (pngHints?.gray16) {
    const { data: raw, info } = await image.autoOrient().pipelineColourspace("grey16")
      .toColourspace("grey16").raw({ depth: "ushort" }).toBuffer({ resolveWithObject: true });
    if (![1, 2].includes(info.channels) || raw.length !== info.width * info.height * info.channels * 2) {
      throw new Error("Invalid 16-bit grayscale");
    }
    const rgba = Buffer.allocUnsafe(info.width * info.height * 4);
    // Pillow keeps grayscale16 samples as integer until conversion to RGB,
    // clipping above 255. Its transparency key is truncated to eight bits.
    for (let i = 0, j = 0; i < raw.length; i += 2 * info.channels, j += 4) {
      const v = Math.min(255, littleEndian ? raw.readUInt16LE(i) : raw.readUInt16BE(i));
      rgba[j] = rgba[j + 1] = rgba[j + 2] = v;
      rgba[j + 3] = v === pngHints.transparentGray ? 0 : 255;
    }
    return { data: rgba, info: { ...info, channels: 4 } };
  }
  return image.autoOrient().toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

function pixelsWithinBounds(width?: number, height?: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) && width! > 0 && height! > 0 &&
    Math.max(width!, height!) <= MAX_IMAGE_SIDE && width! * height! <= MAX_IMAGE_PIXELS;
}

async function decode(name: string, data: Buffer): Promise<AssetRecord> {
  const suffix = posix.extname(name).toLowerCase();
  const file_hash = createHash("sha256").update(data).digest("hex");
  const font = FONT_FORMATS.get(suffix);
  if (font) {
    if (!validFont(data, font.signature)) throw new AssetImportError(`字体头或表目录无效：${name}`);
    return { name, file_hash, mime: font.mime, data, width: 0, height: 0, pixel_hash: file_hash, kind: "font" };
  }
  const expected = IMAGE_FORMATS.get(suffix);
  if (!expected) throw new AssetImportError(`不支持的文件类型：${name}`);
  try {
    const pngHints = expected === "png" ? checkPng(data, name) : undefined;
    const image = sharp(data, { failOn: "warning", limitInputPixels: MAX_IMAGE_PIXELS, ignoreIcc: true });
    const meta = await image.metadata();
    if (meta.format !== expected) throw new Error("Mismatched image format");
    if (!pixelsWithinBounds(meta.width, meta.height)) {
      throw new AssetImportError(`图片尺寸超限：${name}`);
    }
    if ((meta.pages ?? 1) > 1) throw new AssetImportError(`不支持多帧图片：${name}`);

    const { data: rgba, info } = await decodedRgba(image, meta, pngHints);
    const { width, height, channels } = info;
    if (channels !== 4 || rgba.length !== width * height * 4 || !pixelsWithinBounds(width, height)) {
      throw new Error("Invalid RGBA dimensions");
    }
    const prefix = Buffer.alloc(8);
    prefix.writeUInt32BE(width, 0);
    prefix.writeUInt32BE(height, 4);
    const pixel_hash = createHash("sha256").update(prefix).update(rgba).digest("hex");
    const png = await sharp(rgba, { raw: { width, height, channels: 4 }, limitInputPixels: MAX_IMAGE_PIXELS })
      .png({ compressionLevel: 6, palette: false }).toBuffer();
    return { name, file_hash, mime: "image/png", data: normalizePngChunks(png), width, height, pixel_hash, kind: "image" };
  } catch (error) {
    if (error instanceof AssetImportError) throw error;
    if (error instanceof Error && /pixel limit/i.test(error.message)) {
      throw new AssetImportError(`图片尺寸超限：${name}`);
    }
    throw new AssetImportError(`图片格式不符或内容损坏：${name}`);
  }
}

/** Canonical records in input/archive order. Duplicates remain separate records. */
export async function parse_inputs(files: readonly (readonly [string, Buffer])[]): Promise<AssetRecord[]> {
  if (files.length > MAX_FILES) throw new AssetImportError("上传的文件过多");
  let total = 0;
  for (const [, data] of files) {
    if (!Buffer.isBuffer(data)) throw new AssetImportError("上传内容必须为字节");
    total += data.length;
    if (total > MAX_UPLOAD_BYTES) throw new AssetImportError("上传总大小超限");
  }
  let expanded = 0;
  let stored = 0;
  const assets: AssetRecord[] = [];
  for (const [filename, data] of files) {
    const parts = safeName(filename);
    if (isMacMetadata(parts)) continue;
    const leaf = parts[parts.length - 1]!;
    const members = posix.extname(leaf).toLowerCase() === ".zip"
      ? zipEntries(data) : [[leaf, data] as [string, Buffer]];
    for await (const [name, payload] of members) {
      if (assets.length >= MAX_FILES) throw new AssetImportError("导入的有效文件过多");
      expanded += payload.length;
      if (payload.length > MAX_ENTRY_BYTES || expanded > MAX_ZIP_BYTES) {
        throw new AssetImportError("导入文件大小超限");
      }
      const record = await decode(name, payload);
      stored += record.data.length;
      if (stored > MAX_RESULT_BYTES) throw new AssetImportError("转换后的素材总大小超限");
      assets.push(record);
    }
  }
  return assets;
}

export async function preview_image(buffer: Buffer): Promise<Buffer> {
  try {
    return await sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "warning", ignoreIcc: true })
      .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  } catch {
    throw new AssetImportError("无法生成图片预览");
  }
}
