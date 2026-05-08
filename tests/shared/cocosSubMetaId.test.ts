import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  allocateCocosSpriteAtlasSubMetaId,
  cocosNameToSubId,
  plistStemForSpriteAtlasSubMetaName,
} from '../../src/shared/cocosSubMetaId';
import { md5HexUtf8 } from '../../src/shared/md5HexUtf8';

describe('md5HexUtf8', () => {
  it('matches Node crypto on sample strings', () => {
    for (const s of ['', 'a', 'abc', 'export-3-180', '你好']) {
      expect(md5HexUtf8(s)).toBe(createHash('md5').update(s, 'utf8').digest('hex'));
    }
  });
});

describe('cocosSubMetaId', () => {
  it('nameToSubId matches Creator / asset-db (export-3-180 → 95b1d)', () => {
    expect(cocosNameToSubId('export-3-180')).toBe('95b1d');
  });

  it('reserved texture / spriteFrame names match Creator sub ids', () => {
    expect(cocosNameToSubId('texture')).toBe('6c48a');
    expect(cocosNameToSubId('spriteFrame')).toBe('f9941');
  });

  it('plistStem strips extension for meta name', () => {
    expect(plistStemForSpriteAtlasSubMetaName('export-3-180.png')).toBe('export-3-180');
    expect(plistStemForSpriteAtlasSubMetaName('textures/foo.png')).toBe('foo');
  });

  it('allocateCocosSpriteAtlasSubMetaId avoids collisions and reserved ids', () => {
    const used = new Set<string>(['6c48a', 'f9941']);
    const id = allocateCocosSpriteAtlasSubMetaId('export-3-180', used);
    expect(id).toBe('95b1d');
    expect(used.has('95b1d')).toBe(true);
  });
});
