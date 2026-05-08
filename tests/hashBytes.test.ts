import { describe, expect, it } from 'vitest';
import { buildTextureRefCanonicalMap } from '../src/shared/hash';

describe('buildTextureRefCanonicalMap', () => {
  it('merges identical bytes to lexicographically smallest ref', async () => {
    const a = new Uint8Array([1, 2, 3]);
    const map = new Map([
      ['tex/z.png', { bytes: a, width: 1, height: 1 }],
      ['tex/a.png', { bytes: a, width: 1, height: 1 }],
    ]);
    const canon = await buildTextureRefCanonicalMap(map);
    expect(canon.get('tex/z.png')).toBe('tex/a.png');
    expect(canon.get('tex/a.png')).toBe('tex/a.png');
  });

  it('does not merge different bytes', async () => {
    const map = new Map([
      ['r1', { bytes: new Uint8Array([1]), width: 1, height: 1 }],
      ['r2', { bytes: new Uint8Array([2]), width: 1, height: 1 }],
    ]);
    const canon = await buildTextureRefCanonicalMap(map);
    expect(canon.get('r1')).toBe('r1');
    expect(canon.get('r2')).toBe('r2');
  });
});
