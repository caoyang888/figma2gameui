import { decode, encode, convertIndexedToRgb } from "fast-png";
import type { DecodedPng } from "fast-png";
import { MaxRectsPacker, OversizedElementBin } from "maxrects-packer";
import type { PackerBucketPort } from "./packAtlases";

export type BinPackRasterizerOptions = {
  /** 单张合图允许的最大边长（宽、高上限相同）。默认 4096。 */
  atlasMaxSide?: number;
  /** 精灵之间的打包间距（像素），传给 maxrects 的 padding。默认 0。 */
  paddingPx?: number;
  /** 合图尺寸是否向上取到 2 的幂。默认 true（与 maxrects-packer 默认一致）。 */
  pot?: boolean;
};

type SpritePayload = {
  assetRef: string;
  rgba: Uint8Array;
  width: number;
  height: number;
};

function scale16To8(v: number): number {
  return Math.min(255, Math.round((v * 255) / 65535));
}

/**
 * 将 fast-png 解码结果规范为 RGBA8 逐像素交错缓冲区（长度 width*height*4）。
 */
function normalizeDecodedPngToRgba8(decoded: DecodedPng, assetRef: string): SpritePayload {
  const { width, height, depth, channels } = decoded;
  if (width <= 0 || height <= 0) {
    throw new Error(`atlas pack: 非法 PNG 尺寸 assetRef=${assetRef} ${width}x${height}`);
  }

  let src: Uint8Array | Uint16Array;
  let effChannels: number;

  if (decoded.palette) {
    const expanded = convertIndexedToRgb(decoded);
    effChannels = decoded.palette[0]?.length === 4 ? 4 : 3;
    if (effChannels === 3) {
      const out = new Uint8Array(width * height * 4);
      for (let i = 0, j = 0; i < expanded.length; i += 3, j += 4) {
        out[j] = expanded[i]!;
        out[j + 1] = expanded[i + 1]!;
        out[j + 2] = expanded[i + 2]!;
        out[j + 3] = 255;
      }
      return { assetRef, rgba: out, width, height };
    }
    return { assetRef, rgba: new Uint8Array(expanded.buffer, expanded.byteOffset, width * height * 4), width, height };
  }

  const raw = decoded.data;
  if (depth !== 8 && depth !== 16) {
    throw new Error(`atlas pack: 不支持的 PNG 位深 assetRef=${assetRef} depth=${depth}`);
  }

  const bpp = depth === 8 ? 1 : 2;
  const stride = channels * bpp;
  const expectedLen = width * height * stride;
  if (raw.byteLength < expectedLen) {
    throw new Error(`atlas pack: PNG 像素数据长度不足 assetRef=${assetRef}`);
  }

  if (depth === 8) {
    const u8 = raw instanceof Uint8Array ? raw : new Uint8Array(raw.buffer, raw.byteOffset, expectedLen);
    if (channels === 4) {
      return { assetRef, rgba: new Uint8Array(u8), width, height };
    }
    if (channels === 3) {
      const out = new Uint8Array(width * height * 4);
      for (let i = 0, j = 0; i < width * height * 3; i += 3, j += 4) {
        out[j] = u8[i]!;
        out[j + 1] = u8[i + 1]!;
        out[j + 2] = u8[i + 2]!;
        out[j + 3] = 255;
      }
      return { assetRef, rgba: out, width, height };
    }
    if (channels === 2) {
      const out = new Uint8Array(width * height * 4);
      for (let i = 0, j = 0; i < width * height * 2; i += 2, j += 4) {
        const g = u8[i]!;
        out[j] = g;
        out[j + 1] = g;
        out[j + 2] = g;
        out[j + 3] = u8[i + 1]!;
      }
      return { assetRef, rgba: out, width, height };
    }
    if (channels === 1) {
      const out = new Uint8Array(width * height * 4);
      for (let i = 0, j = 0; i < width * height; i++, j += 4) {
        const g = u8[i]!;
        out[j] = g;
        out[j + 1] = g;
        out[j + 2] = g;
        out[j + 3] = 255;
      }
      return { assetRef, rgba: out, width, height };
    }
  } else {
    src = raw instanceof Uint16Array ? raw : new Uint16Array(raw.buffer, raw.byteOffset, (width * height * channels));
    effChannels = channels;
    const out = new Uint8Array(width * height * 4);
    if (effChannels === 4) {
      for (let i = 0, j = 0; i < width * height * 4; i += 4, j += 4) {
        out[j] = scale16To8(src[i]!);
        out[j + 1] = scale16To8(src[i + 1]!);
        out[j + 2] = scale16To8(src[i + 2]!);
        out[j + 3] = scale16To8(src[i + 3]!);
      }
      return { assetRef, rgba: out, width, height };
    }
    if (effChannels === 3) {
      for (let i = 0, j = 0; i < width * height * 3; i += 3, j += 4) {
        out[j] = scale16To8(src[i]!);
        out[j + 1] = scale16To8(src[i + 1]!);
        out[j + 2] = scale16To8(src[i + 2]!);
        out[j + 3] = 255;
      }
      return { assetRef, rgba: out, width, height };
    }
    if (effChannels === 2) {
      for (let i = 0, j = 0; i < width * height * 2; i += 2, j += 4) {
        const g = scale16To8(src[i]!);
        out[j] = g;
        out[j + 1] = g;
        out[j + 2] = g;
        out[j + 3] = scale16To8(src[i + 1]!);
      }
      return { assetRef, rgba: out, width, height };
    }
    if (effChannels === 1) {
      for (let i = 0, j = 0; i < width * height; i++, j += 4) {
        const g = scale16To8(src[i]!);
        out[j] = g;
        out[j + 1] = g;
        out[j + 2] = g;
        out[j + 3] = 255;
      }
      return { assetRef, rgba: out, width, height };
    }
  }

  throw new Error(`atlas pack: 不支持的 PNG 通道数 assetRef=${assetRef} channels=${channels} depth=${depth}`);
}

/** Porter-Duff source-over，非预乘 RGBA8（分量 0–255）。 */
function blendSourceOverRgba8(
  dst: Uint8Array,
  dw: number,
  dh: number,
  src: Uint8Array,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
): void {
  for (let sy = 0; sy < sh; sy++) {
    for (let sx = 0; sx < sw; sx++) {
      const tx = dx + sx;
      const ty = dy + sy;
      if (tx < 0 || ty < 0 || tx >= dw || ty >= dh) continue;
      const si = (sy * sw + sx) * 4;
      const di = (ty * dw + tx) * 4;

      const sR = src[si]!;
      const sG = src[si + 1]!;
      const sB = src[si + 2]!;
      const sA = src[si + 3]!;
      if (sA === 0) continue;

      const dR = dst[di]!;
      const dG = dst[di + 1]!;
      const dB = dst[di + 2]!;
      const dA = dst[di + 3]!;

      if (sA === 255) {
        dst[di] = sR;
        dst[di + 1] = sG;
        dst[di + 2] = sB;
        dst[di + 3] = 255;
        continue;
      }

      const as = sA / 255;
      const ad = dA / 255;
      const ao = as + ad * (1 - as);
      if (ao <= 0) {
        dst[di] = 0;
        dst[di + 1] = 0;
        dst[di + 2] = 0;
        dst[di + 3] = 0;
        continue;
      }
      const invAs = 1 - as;
      const rs = sR / 255;
      const gs = sG / 255;
      const bs = sB / 255;
      const rd = dR / 255;
      const gd = dG / 255;
      const bd = dB / 255;
      dst[di] = Math.round(((rs * as + rd * ad * invAs) / ao) * 255);
      dst[di + 1] = Math.round(((gs * as + gd * ad * invAs) / ao) * 255);
      dst[di + 2] = Math.round(((bs * as + bd * ad * invAs) / ao) * 255);
      dst[di + 3] = Math.round(ao * 255);
    }
  }
}

/**
 * 默认合图：maxrects-packer（无旋转）排布 + fast-png 解码/编码，RGBA source-over 合成。
 */
export function createBinPackRasterizer(options?: BinPackRasterizerOptions): PackerBucketPort {
  const atlasMaxSide = options?.atlasMaxSide ?? 4096;
  const paddingPx = options?.paddingPx ?? 0;
  const pot = options?.pot ?? true;

  return async ({ atlasKey, sprites }) => {
    if (sprites.length === 0) {
      throw new Error("atlas pack: sprites 为空");
    }

    const prepared: SpritePayload[] = [];
    for (const s of sprites) {
      const decoded = decode(s.bytes);
      // Use decoded PNG dimensions as the source of truth; upstream logical
      // width/height may differ due to export constraints or scaling presets.
      prepared.push(normalizeDecodedPngToRgba8(decoded, s.assetRef));
    }

    const packer = new MaxRectsPacker(atlasMaxSide, atlasMaxSide, paddingPx, {
      allowRotation: false,
      pot,
      square: false,
      smart: true,
    });

    for (const p of prepared) {
      packer.add(p.width, p.height, p);
    }

    if (packer.bins.some((b) => b instanceof OversizedElementBin)) {
      throw new Error("atlas pack: 存在超出 atlasMaxSide 的精灵");
    }
    const pages: Array<{
      atlasKey: string;
      pngBytes: Uint8Array;
      width: number;
      height: number;
      rects: Map<string, { x: number; y: number; width: number; height: number }>;
    }> = [];
    let pageIndex = 0;
    for (const bin of packer.bins) {
      if (bin.rects.length === 0) continue;
      const atlasW = bin.width;
      const atlasH = bin.height;
      const atlas = new Uint8Array(atlasW * atlasH * 4);
      const rects = new Map<string, { x: number; y: number; width: number; height: number }>();
      for (const r of bin.rects) {
        const payload = r.data as SpritePayload | undefined;
        if (!payload?.assetRef) {
          throw new Error("atlas pack: 打包矩形缺少精灵数据");
        }
        rects.set(payload.assetRef, { x: r.x, y: r.y, width: r.width, height: r.height });
        blendSourceOverRgba8(atlas, atlasW, atlasH, payload.rgba, payload.width, payload.height, r.x, r.y);
      }
      const pngBytes = encode({
        width: atlasW,
        height: atlasH,
        data: atlas,
        depth: 8,
        channels: 4,
      });
      pages.push({
        atlasKey: `${atlasKey}-${pageIndex}`,
        pngBytes,
        width: atlasW,
        height: atlasH,
        rects,
      });
      pageIndex += 1;
    }
    for (const s of sprites) {
      if (!pages.some((p) => p.rects.has(s.assetRef))) {
        throw new Error(`atlas pack: 精灵未获得放置矩形 assetRef=${s.assetRef}`);
      }
    }
    return pages;
  };
}
