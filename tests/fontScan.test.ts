import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  collectFontKeysFromSceneSubtree,
  collectFontKeysFromExportSubtreesInFrames,
} from '../src/domain/discovery/fontScan';
import * as exportDiscovery from '../src/domain/discovery/exportDiscovery';

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

describe('collectFontKeysFromExportSubtreesInFrames', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('unions keys from each export root subtree across frames', () => {
    const exportA = mockGroup('expA', [mockText('t1', 'F1', 'Regular')]);
    const exportB = mockGroup('expB', [mockText('t2', 'F2', 'Bold')]);
    vi.spyOn(exportDiscovery, 'discoverExportNodesInFrame').mockImplementation((frame: FrameNode) => {
      if (frame.id === 'f1') {
        return [exportA];
      }
      if (frame.id === 'f2') {
        return [exportB];
      }
      return [];
    });
    const f1 = { type: 'FRAME', id: 'f1', name: 'F1', children: [] } as unknown as FrameNode;
    const f2 = { type: 'FRAME', id: 'f2', name: 'F2', children: [] } as unknown as FrameNode;
    expect(collectFontKeysFromExportSubtreesInFrames([f1, f2])).toEqual(['F1|Regular', 'F2|Bold']);
  });

  it('dedupes keys that appear in multiple export roots', () => {
    const exportA = mockGroup('expA', [mockText('t1', 'Same', 'Regular')]);
    const exportB = mockGroup('expB', [mockText('t2', 'Same', 'Regular')]);
    vi.spyOn(exportDiscovery, 'discoverExportNodesInFrame').mockReturnValue([exportA, exportB]);
    const frame = { type: 'FRAME', id: 'f1', name: 'F1', children: [] } as unknown as FrameNode;
    expect(collectFontKeysFromExportSubtreesInFrames([frame])).toEqual(['Same|Regular']);
  });
});
