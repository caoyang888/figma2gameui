import { describe, expect, it } from 'vitest';
import { readPngIhdrDimensions } from '../src/shared/pngDimensions';

describe('readPngIhdrDimensions', () => {
  it('returns undefined for too short buffer', () => {
    expect(readPngIhdrDimensions(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeUndefined();
  });

  it('returns undefined for non-PNG', () => {
    const b = new Uint8Array(32);
    b.fill(0);
    expect(readPngIhdrDimensions(b)).toBeUndefined();
  });

  it('reads width and height from IHDR', () => {
    const buf = new Uint8Array(24);
    buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    buf[8] = 0;
    buf[9] = 0;
    buf[10] = 0;
    buf[11] = 13;
    buf[12] = 0x49;
    buf[13] = 0x48;
    buf[14] = 0x44;
    buf[15] = 0x52;
    buf[16] = 0;
    buf[17] = 0;
    buf[18] = 1;
    buf[19] = 0x90;
    buf[20] = 0;
    buf[21] = 0;
    buf[22] = 1;
    buf[23] = 0x2c;
    expect(readPngIhdrDimensions(buf)).toEqual({ width: 400, height: 300 });
  });
});
