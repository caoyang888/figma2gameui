import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildNoFramesResolvedMessage,
  filterFramesFromSelection,
  resolveFramesByIdsDetailed,
} from '../src/domain/discovery/selection';
import { discoverExportNodesInFrame, filterTopLevelExportNodes } from '../src/domain/discovery/exportDiscovery';

function mockFrame(overrides: Record<string, unknown> = {}): FrameNode {
  return {
    type: 'FRAME',
    id: 'frame',
    name: 'Frame',
    children: [],
    ...overrides,
  } as unknown as FrameNode;
}

describe('resolveFramesByIdsDetailed', () => {
  beforeEach(() => {
    vi.stubGlobal('figma', {
      getNodeById: (id: string) => {
        if (id === 'f1') return { type: 'FRAME', id: 'f1' };
        if (id === 'g1') return { type: 'GROUP', id: 'g1' };
        return null;
      },
    });
  });

  it('collects frames, missing ids, and wrong types', () => {
    const r = resolveFramesByIdsDetailed(['f1', 'missing', 'g1', 'f1']);
    expect(r.frames.map((f) => f.id)).toEqual(['f1']);
    expect(r.requestedIds).toEqual(['f1', 'missing', 'g1']);
    expect(r.missingIds).toEqual(['missing']);
    expect(r.wrongTypeIds).toEqual([{ id: 'g1', type: 'GROUP' }]);
  });

  it('buildNoFramesResolvedMessage explains missing and wrong-type ids', () => {
    const r = resolveFramesByIdsDetailed(['missing', 'g1']);
    const msg = buildNoFramesResolvedMessage(r);
    expect(msg).toContain('已选 2 个目标');
    expect(msg).toContain('成功解析 0 个 Frame');
    expect(msg).toContain('missing');
    expect(msg).toContain('g1(GROUP)');
  });

  it('buildNoFramesResolvedMessage for empty selection', () => {
    expect(buildNoFramesResolvedMessage(resolveFramesByIdsDetailed([]))).toBe(
      '请在左侧勾选至少一个要导出的 Frame。',
    );
  });
});

describe('filterFramesFromSelection', () => {
  it('returns only frames preserving order', () => {
    const mock = [
      { type: 'RECTANGLE', id: 'r1' },
      { type: 'FRAME', id: 'f1' },
      { type: 'FRAME', id: 'f2' },
    ] as unknown as readonly BaseNode[];
    expect(filterFramesFromSelection(mock).map((f) => f.id)).toEqual(['f1', 'f2']);
  });

  it('returns empty array when no frames', () => {
    const mock = [
      { type: 'TEXT', id: 't1' },
      { type: 'GROUP', id: 'g1' },
    ] as unknown as readonly BaseNode[];
    expect(filterFramesFromSelection(mock)).toEqual([]);
  });
});

describe('discoverExportNodesInFrame', () => {
  it('returns empty array when subtree has no export settings', () => {
    const frame = mockFrame({
      children: [
        { type: 'RECTANGLE', id: 'r1', exportSettings: [] },
        {
          type: 'GROUP',
          id: 'g1',
          children: [{ type: 'ELLIPSE', id: 'e1', exportSettings: [] }],
        },
      ],
    });
    expect(discoverExportNodesInFrame(frame)).toEqual([]);
  });

  it('collects nodes with non-empty exportSettings via DFS preorder', () => {
    const inner = { type: 'RECTANGLE', id: 'inner', exportSettings: [{ format: 'PNG' }] };
    const sibling = { type: 'RECTANGLE', id: 'sibling', exportSettings: [{ format: 'PNG' }] };
    const frame = mockFrame({
      children: [
        {
          type: 'GROUP',
          id: 'outer',
          exportSettings: [],
          children: [inner],
        },
        sibling,
      ],
    });
    const found = discoverExportNodesInFrame(frame);
    expect(found.map((n) => n.id)).toEqual(['inner', 'sibling']);
  });

  it('includes the frame root when it has exports', () => {
    const frame = mockFrame({
      id: 'root',
      exportSettings: [{ format: 'PNG' }],
      children: [{ type: 'RECTANGLE', id: 'child', exportSettings: [{ format: 'PNG' }] }],
    });
    const found = discoverExportNodesInFrame(frame);
    expect(found.map((n) => n.id)).toEqual(['root', 'child']);
  });

  it('ignores hidden nodes even if they have export settings', () => {
    const frame = mockFrame({
      children: [
        { type: 'RECTANGLE', id: 'hidden', visible: false, exportSettings: [{ format: 'PNG' }] },
        { type: 'RECTANGLE', id: 'visible', visible: true, exportSettings: [{ format: 'PNG' }] },
      ],
    });
    const found = discoverExportNodesInFrame(frame);
    expect(found.map((n) => n.id)).toEqual(['visible']);
  });

  it('filters nested export nodes and keeps only top-level roots', () => {
    const root = {
      type: 'GROUP',
      id: 'rootExport',
      exportSettings: [{ format: 'PNG' }],
      parent: null,
      children: [],
    } as unknown as SceneNode;
    const child = {
      type: 'RECTANGLE',
      id: 'childExport',
      exportSettings: [{ format: 'PNG' }],
      parent: root,
      children: [],
    } as unknown as SceneNode;
    (root as unknown as { children: SceneNode[] }).children = [child];
    const filtered = filterTopLevelExportNodes([root, child]);
    expect(filtered.map((n) => n.id)).toEqual(['rootExport']);
  });
});
