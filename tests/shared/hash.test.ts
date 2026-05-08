import { describe, it, expect } from 'vitest';
import { sha256Hex, buildTextureRefCanonicalMap, type TexturePayload } from '../../src/shared/hash';

describe('hash (new path)', () => {
  it('sha256Hex produces hex string', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const hex = await sha256Hex(bytes);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('buildTextureRefCanonicalMap merges identical bytes', async () => {
    const a = new Uint8Array([1, 2, 3]);
    const map = new Map<string, TexturePayload>([
      ['ref-a', { bytes: a, width: 10, height: 10 }],
      ['ref-b', { bytes: new Uint8Array([1, 2, 3]), width: 10, height: 10 }],
    ]);
    const canon = await buildTextureRefCanonicalMap(map);
    expect(canon.get('ref-a')).toBe(canon.get('ref-b'));
  });
});
