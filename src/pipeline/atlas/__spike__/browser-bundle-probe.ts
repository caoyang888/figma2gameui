/**
 * Browser-target bundle probe: maxrects-packer + fast-png + RGBA blit (no Node builtins).
 */
import { decode, encode } from "fast-png";
import { MaxRectsPacker } from "maxrects-packer";

function rgba1x1(r: number, g: number, b: number, a: number): Uint8Array {
  const d = new Uint8Array(4);
  d[0] = r;
  d[1] = g;
  d[2] = b;
  d[3] = a;
  return d;
}

/** Opaque source-over blit (probe sprites are fully opaque). */
function blitOpaque(
  dst: Uint8Array,
  dw: number,
  dh: number,
  src: Uint8ClampedArray | Uint8Array,
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
      dst[di] = src[si];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      dst[di + 3] = src[si + 3];
    }
  }
}

export function runAtlasBrowserProbe(): string {
  const imgA = { width: 1, height: 1, data: rgba1x1(255, 0, 0, 255), channels: 4 as const };
  const imgB = { width: 1, height: 1, data: rgba1x1(0, 0, 255, 255), channels: 4 as const };

  const pngA = encode(imgA);
  const pngB = encode(imgB);
  const decA = decode(pngA);
  const decB = decode(pngB);

  const packer = new MaxRectsPacker(64, 64, 0, {
    allowRotation: false,
    pot: false,
    square: false,
    smart: true,
  });
  packer.add(1, 1, { id: "a" });
  packer.add(1, 1, { id: "b" });

  const bin = packer.bins[0];
  const rects = bin.rects;
  const bw = bin.width;
  const bh = bin.height;
  const atlas = new Uint8Array(bw * bh * 4);

  const dataA = new Uint8Array(decA.data.buffer, decA.data.byteOffset, decA.width * decA.height * 4);
  const dataB = new Uint8Array(decB.data.buffer, decB.data.byteOffset, decB.width * decB.height * 4);

  for (const r of rects) {
    const id = r.data?.id as string | undefined;
    const src = id === "a" ? dataA : id === "b" ? dataB : null;
    if (!src) continue;
    const sw = id === "a" ? decA.width : decB.width;
    const sh = id === "a" ? decA.height : decB.height;
    blitOpaque(atlas, bw, bh, src, sw, sh, r.x, r.y);
  }

  encode({ width: bw, height: bh, data: atlas, channels: 4 });

  const summary = `atlas-browser-probe ok bin=${bw}x${bh} rects=${rects.length} pngRoundtrip=ok`;
  console.log(summary);
  return summary;
}
