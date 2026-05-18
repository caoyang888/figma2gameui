import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  collectFontKeysFromSceneSubtree,
  collectFontKeysFromExportSubtreesInFrames,
  collapseFontKeysByMappedAsset,
  dedupeSortedFontKeys,
  fontDedupeIdentityKey,
  normalizeFontKeyStored,
  remapFontRecord,
  alignFontRecordToKeys,
  buildFontRegistryFromSceneSubtree,
} from '../src/domain/discovery/fontScan';

function mockText(id: string, family: string, style: string): TextNode {
  return {
    type: 'TEXT',
    id,
    name: id,
    fontName: { family, style },
  } as unknown as TextNode;
}

function mockGroup(id: string, children: SceneNode[]): SceneNode {
  return {
    type: 'GROUP',
    id,
    name: id,
    children,
  } as unknown as SceneNode;
}

describe('collectFontKeysFromSceneSubtree', () => {
  it('returns empty array when subtree has no TEXT nodes', () => {
    const root = mockGroup('g1', [{ type: 'RECTANGLE', id: 'r1' } as unknown as SceneNode]);
    expect(collectFontKeysFromSceneSubtree(root)).toEqual([]);
  });

  it('collects Family|Style from TEXT nodes via DFS and dedupes', () => {
    const t1 = mockText('t1', 'Roboto', 'Bold');
    const t2 = mockText('t2', 'Roboto', 'Bold');
    const t3 = mockText('t3', 'Roboto', 'Regular');
    const root = mockGroup('root', [t1, mockGroup('inner', [t2, t3])]);
    expect(collectFontKeysFromSceneSubtree(root)).toEqual(['Roboto|Bold', 'Roboto|Regular']);
  });

  it('sorts keys lexicographically', () => {
    const root = mockGroup('root', [mockText('a', 'Zebra', 'Italic'), mockText('b', 'Arial', 'Bold')]);
    expect(collectFontKeysFromSceneSubtree(root)).toEqual(['Arial|Bold', 'Zebra|Italic']);
  });

  it('ignores TEXT nodes without concrete fontName (mixed)', () => {
    const mixed = {
      type: 'TEXT',
      id: 'tm',
      name: 'tm',
      fontName: Symbol('mixed'),
    } as unknown as TextNode;
    const root = mockGroup('root', [mixed, mockText('ok', 'X', 'Regular')]);
    expect(collectFontKeysFromSceneSubtree(root)).toEqual(['X|Regular']);
  });
});

describe('normalizeFontKeyStored / dedupeSortedFontKeys', () => {
  it('merges keys that differ only by whitespace', () => {
    expect(normalizeFontKeyStored('Roboto | Regular')).toBe('Roboto|Regular');
    expect(dedupeSortedFontKeys(['Roboto|Regular', 'Roboto | Regular', 'Arial|Bold'])).toEqual([
      'Arial|Bold',
      'Roboto|Regular',
    ]);
  });

  it('merges keys that differ only by family/style casing', () => {
    expect(fontDedupeIdentityKey('Roboto|Regular')).toBe(fontDedupeIdentityKey('roboto|regular'));
    expect(dedupeSortedFontKeys(['Roboto|Regular', 'roboto|Regular', 'ROBOTO|regular'])).toEqual([
      'Roboto|Regular',
    ]);
  });

  it('merges common style aliases (Regular vs Normal vs 400)', () => {
    expect(dedupeSortedFontKeys(['Arial|Regular', 'Arial|Normal', 'Arial|400'])).toEqual(['Arial|Regular']);
  });

  it('merges family names that differ only by spaces or hyphens', () => {
    expect(
      dedupeSortedFontKeys(['ChiuKong Gothic M|Bold', 'ChiuKongGothic-M|Bold', 'ChiuKongGothic M|Bold']),
    ).toEqual(['ChiuKong Gothic M|Bold']);
  });

  it('merges ChiuKong Gothic CL/MN and Heavy/Bold into one key', () => {
    expect(
      dedupeSortedFontKeys(['ChiuKong Gothic CL|Heavy', 'ChiuKong Gothic MN|Bold']),
    ).toEqual(['ChiuKong Gothic CL|Heavy']);
    const reg = buildFontRegistryFromSceneSubtree(
      mockGroup('root', [
        mockText('a', 'ChiuKong Gothic CL', 'Heavy'),
        mockText('b', 'ChiuKong Gothic MN', 'Bold'),
      ]),
    );
    expect(reg.keys).toEqual(['ChiuKong Gothic CL|Heavy']);
    expect(reg.aliasToCanonical['ChiuKong Gothic MN|Bold']).toBe('ChiuKong Gothic CL|Heavy');
  });

  it('collapseFontKeysByMappedAsset merges rows with same ttf and uuid', () => {
    const keys = ['FontA|Bold', 'FontB|Bold'];
    const fontMap = { 'FontA|Bold': 'ChiuKongGothic-M-Bold.ttf', 'FontB|Bold': 'ChiuKongGothic-M-Bold.ttf' };
    const fontUuid = {
      'FontA|Bold': '58c8863f-7aa2-4d0a-8f49-de30621ce350',
      'FontB|Bold': '58c8863f-7aa2-4d0a-8f49-de30621ce350',
    };
    expect(collapseFontKeysByMappedAsset(keys, fontMap, fontUuid)).toEqual(['FontA|Bold']);
  });

  it('buildFontRegistryFromSceneSubtree maps raw IR keys to canonical', () => {
    const t1 = mockText('t1', 'ChiuKong Gothic M', 'Bold');
    const t2 = mockText('t2', 'ChiuKongGothic M', 'Bold');
    const root = mockGroup('root', [t1, t2]);
    const reg = buildFontRegistryFromSceneSubtree(root);
    expect(reg.keys).toEqual(['ChiuKong Gothic M|Bold']);
    expect(reg.aliasToCanonical['ChiuKongGothic M|Bold']).toBe('ChiuKong Gothic M|Bold');
  });

  it('remapFontRecord merges alias keys and alignFontRecordToKeys keeps one row', () => {
    const remapped = remapFontRecord({
      'roboto|regular': 'a.ttf',
      'Roboto|Regular': 'b.ttf',
    });
    expect(Object.keys(remapped)).toHaveLength(1);
    const keys = dedupeSortedFontKeys(['Roboto|Regular', 'roboto|regular']);
    const aligned = alignFontRecordToKeys(remapped, keys);
    expect(Object.keys(aligned)).toEqual(['Roboto|Regular']);
    expect(aligned['Roboto|Regular']).toBe('a.ttf');
  });
});

describe('collectFontKeysFromExportSubtreesInFrames', () => {
  it('unions keys across selected frames', () => {
    const f1 = {
      type: 'FRAME',
      id: 'f1',
      name: 'F1',
      children: [mockText('t1', 'F1', 'Regular')],
    } as unknown as FrameNode;
    const f2 = {
      type: 'FRAME',
      id: 'f2',
      name: 'F2',
      children: [mockText('t2', 'F2', 'Bold')],
    } as unknown as FrameNode;
    expect(collectFontKeysFromExportSubtreesInFrames([f1, f2])).toEqual(['F1|Regular', 'F2|Bold']);
  });

  it('dedupes same font under nested groups within one frame', () => {
    const t1 = mockText('t1', 'Same', 'Regular');
    const t2 = mockText('t2', 'Same', 'Regular');
    const frame = {
      type: 'FRAME',
      id: 'f1',
      name: 'F1',
      children: [mockGroup('g1', [t1, mockGroup('g2', [t2])])],
    } as unknown as FrameNode;
    expect(collectFontKeysFromExportSubtreesInFrames([frame])).toEqual(['Same|Regular']);
  });
});
