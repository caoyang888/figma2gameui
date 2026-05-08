import { describe, it, expect } from "vitest";
import { decode, encode } from "fast-png";
import { createBinPackRasterizer } from "../../../src/pipeline/atlas/binPackAndRasterize";

function rgbaPngBytes(width: number, height: number, rgba: Uint8Array): Uint8Array {
  return encode({ width, height, data: rgba, depth: 8, channels: 4 });
}

describe("createBinPackRasterizer", () => {
  it("packs multiple tiny PNGs: roundtrip decode, rects and dimensions valid", async () => {
    const w1 = 2;
    const h1 = 1;
    const d1 = new Uint8Array(w1 * h1 * 4);
    d1.set([255, 0, 0, 255, 0, 255, 0, 255]);
    const bytes1 = rgbaPngBytes(w1, h1, d1);

    const w2 = 1;
    const h2 = 2;
    const d2 = new Uint8Array(w2 * h2 * 4);
    d2.set([0, 0, 255, 255, 255, 255, 0, 128], 0);
    const bytes2 = rgbaPngBytes(w2, h2, d2);

    const pack = createBinPackRasterizer({ atlasMaxSide: 64, paddingPx: 1, pot: false });
    const pages = await pack({
      atlasKey: "atlas-0",
      sprites: [
        { assetRef: "a", bytes: bytes1, width: w1, height: h1 },
        { assetRef: "b", bytes: bytes2, width: w2, height: h2 },
      ],
    });
    expect(pages.length).toBeGreaterThan(0);
    const out = pages[0]!;

    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
    expect(out.pngBytes.length).toBeGreaterThan(8);

    const ra = out.rects.get("a");
    const rb = out.rects.get("b");
    expect(ra).toBeDefined();
    expect(rb).toBeDefined();
    expect(ra!.width).toBe(w1);
    expect(ra!.height).toBe(h1);
    expect(rb!.width).toBe(w2);
    expect(rb!.height).toBe(h2);

    const dec = decode(out.pngBytes);
    expect(dec.width).toBe(out.width);
    expect(dec.height).toBe(out.height);
    expect(dec.channels).toBe(4);
    expect(dec.depth).toBe(8);

    const overlap =
      ra!.x < rb!.x + rb!.width &&
      ra!.x + ra!.width > rb!.x &&
      ra!.y < rb!.y + rb!.height &&
      ra!.y + ra!.height > rb!.y;
    expect(overlap).toBe(false);
  });

  it("semi-transparent sprite over transparent atlas follows source-over (approx)", async () => {
    const w = 1;
    const h = 1;
    const d = new Uint8Array([200, 10, 30, 102]);
    const bytes = rgbaPngBytes(w, h, d);

    const pack = createBinPackRasterizer({ atlasMaxSide: 32, paddingPx: 0, pot: false });
    const pages = await pack({
      atlasKey: "t",
      sprites: [{ assetRef: "half", bytes, width: w, height: h }],
    });
    const out = pages[0]!;

    const rect = out.rects.get("half")!;
    const dec = decode(out.pngBytes);
    const data = new Uint8Array(dec.data.buffer, dec.data.byteOffset, dec.width * dec.height * 4);
    const i = (rect.y * dec.width + rect.x) * 4;

    const sR = 200;
    const sG = 10;
    const sB = 30;
    const sA = 102;
    const dR = 0;
    const dG = 0;
    const dB = 0;
    const dA = 0;
    const as = sA / 255;
    const ad = dA / 255;
    const ao = as + ad * (1 - as);
    const invAs = 1 - as;
    const eR = Math.round(((sR / 255) * as + (dR / 255) * ad * invAs) / ao * 255);
    const eG = Math.round(((sG / 255) * as + (dG / 255) * ad * invAs) / ao * 255);
    const eB = Math.round(((sB / 255) * as + (dB / 255) * ad * invAs) / ao * 255);
    const eA = Math.round(ao * 255);

    expect(data[i]).toBeCloseTo(eR, 0);
    expect(data[i + 1]).toBeCloseTo(eG, 0);
    expect(data[i + 2]).toBeCloseTo(eB, 0);
    expect(data[i + 3]).toBeCloseTo(eA, 0);
  });

  it("splits into multiple pages when one page cannot fit all sprites", async () => {
    const mk2 = (r: number) => {
      const d = new Uint8Array(2 * 2 * 4).fill(0);
      for (let i = 0; i < 4; i++) {
        d[i * 4] = r;
        d[i * 4 + 3] = 255;
      }
      return rgbaPngBytes(2, 2, d);
    };
    const pack = createBinPackRasterizer({ atlasMaxSide: 2, paddingPx: 0, pot: false });
    const pages = await pack({
      atlasKey: "x",
      sprites: [
        { assetRef: "u1", bytes: mk2(40), width: 2, height: 2 },
        { assetRef: "u2", bytes: mk2(80), width: 2, height: 2 },
      ],
    });
    expect(pages.length).toBeGreaterThan(1);
  });

  it("uses decoded PNG dimensions when input width/height disagree", async () => {
    const bytes = rgbaPngBytes(2, 2, new Uint8Array(2 * 2 * 4).fill(255));
    const pack = createBinPackRasterizer({ atlasMaxSide: 64 });
    const pages = await pack({
      atlasKey: "mismatch-ok",
      sprites: [{ assetRef: "x", bytes, width: 1, height: 1 }],
    });
    const out = pages[0]!;
    expect(out.rects.get("x")).toEqual({ x: 0, y: 0, width: 2, height: 2 });
  });
});
