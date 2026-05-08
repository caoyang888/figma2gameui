import { describe, it, expect } from 'vitest';
import { annotateExportTree, collectNodesToHideForExport, collectRasterNodes } from '../src/domain/discovery/annotate';

type MockNode = {
  type: string;
  id: string;
  name: string;
  visible: boolean;
  exportSettings?: unknown[];
  children?: MockNode[];
  parent?: MockNode | null;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
};

function link(nodes: MockNode[]): void {
  for (const node of nodes) {
    if (node.children) {
      for (const child of node.children) {
        child.parent = node;
      }
      link(node.children);
    }
  }
}

function mockFrame(children: MockNode[]): FrameNode {
  const frame: MockNode = {
    type: 'FRAME',
    id: 'frame',
    name: 'TestFrame',
    visible: true,
    children,
    width: 400,
    height: 300,
  };
  link([frame]);
  return frame as unknown as FrameNode;
}

describe('annotateExportTree', () => {
  it('marks a simple export group as exportRoot', () => {
    const frame = mockFrame([
      { type: 'GROUP', id: 'g1', name: 'G1', visible: true, exportSettings: [{ format: 'PNG' }], children: [] },
    ]);
    const roles = annotateExportTree(frame);
    expect(roles.get('g1')?.role).toBe('exportRoot');
  });

  it('prunes container with no export descendants', () => {
    const frame = mockFrame([
      {
        type: 'GROUP', id: 'g1', name: 'G1', visible: true, children: [
          { type: 'RECTANGLE', id: 'r1', name: 'R1', visible: true, children: [] },
        ],
      },
    ]);
    const roles = annotateExportTree(frame);
    expect(roles.get('g1')?.role).toBe('pruned');
    expect(roles.get('r1')?.role).toBe('pruned');
  });

  it('marks passthrough container when descendant has export', () => {
    const frame = mockFrame([
      {
        type: 'GROUP', id: 'container', name: 'Container', visible: true, children: [
          { type: 'GROUP', id: 'inner', name: 'Inner', visible: true, exportSettings: [{ format: 'PNG' }], children: [] },
        ],
      },
    ]);
    const roles = annotateExportTree(frame);
    expect(roles.get('container')?.role).toBe('passthrough');
    expect(roles.get('inner')?.role).toBe('exportRoot');
  });

  it('marks nested export as childExport', () => {
    const frame = mockFrame([
      {
        type: 'GROUP', id: 'parent', name: 'Parent', visible: true, exportSettings: [{ format: 'PNG' }], children: [
          { type: 'GROUP', id: 'child', name: 'Child', visible: true, exportSettings: [{ format: 'PNG' }], children: [] },
        ],
      },
    ]);
    const roles = annotateExportTree(frame);
    expect(roles.get('parent')?.role).toBe('exportRoot');
    expect(roles.get('child')?.role).toBe('childExport');
  });

  it('marks TEXT with export under exported ancestor as label', () => {
    const frame = mockFrame([
      {
        type: 'GROUP', id: 'g1', name: 'G1', visible: true, exportSettings: [{ format: 'PNG' }], children: [
          { type: 'TEXT', id: 't1', name: 'T1', visible: true, exportSettings: [{ format: 'PNG' }], children: [] },
        ],
      },
    ]);
    const roles = annotateExportTree(frame);
    expect(roles.get('t1')?.role).toBe('label');
  });

  it('marks TEXT with export but no exported ancestor as exportRoot', () => {
    const frame = mockFrame([
      { type: 'TEXT', id: 't1', name: 'T1', visible: true, exportSettings: [{ format: 'PNG' }] },
    ]);
    const roles = annotateExportTree(frame);
    expect(roles.get('t1')?.role).toBe('exportRoot');
  });

  it('marks TEXT without export as pruned', () => {
    const frame = mockFrame([
      { type: 'TEXT', id: 't1', name: 'T1', visible: true, children: [] },
    ]);
    const roles = annotateExportTree(frame);
    expect(roles.get('t1')?.role).toBe('pruned');
  });

  it('prunes invisible nodes', () => {
    const frame = mockFrame([
      { type: 'GROUP', id: 'g1', name: 'G1', visible: false, exportSettings: [{ format: 'PNG' }], children: [] },
    ]);
    const roles = annotateExportTree(frame);
    expect(roles.get('g1')?.role).toBe('pruned');
  });

  it('handles deep nesting: export > passthrough > childExport + label', () => {
    const frame = mockFrame([
      {
        type: 'GROUP', id: 'root-export', name: 'RootExport', visible: true,
        exportSettings: [{ format: 'PNG' }],
        children: [
          {
            type: 'FRAME', id: 'middle', name: 'Middle', visible: true,
            children: [
              { type: 'GROUP', id: 'nested-export', name: 'NestedExport', visible: true, exportSettings: [{ format: 'PNG' }], children: [] },
              { type: 'TEXT', id: 'label-text', name: 'LabelText', visible: true, exportSettings: [{ format: 'PNG' }], children: [] },
            ],
          },
        ],
      },
    ]);
    const roles = annotateExportTree(frame);
    expect(roles.get('root-export')?.role).toBe('exportRoot');
    expect(roles.get('middle')?.role).toBe('passthrough');
    expect(roles.get('nested-export')?.role).toBe('childExport');
    expect(roles.get('label-text')?.role).toBe('label');
  });

  it('marks exported container as non-rasterized when all direct children are exported', () => {
    const frame = mockFrame([
      {
        type: 'GROUP',
        id: 'parent-export',
        name: 'ParentExport',
        visible: true,
        exportSettings: [{ format: 'PNG' }],
        children: [
          { type: 'GROUP', id: 'c1', name: 'C1', visible: true, exportSettings: [{ format: 'PNG' }], children: [] },
          { type: 'GROUP', id: 'c2', name: 'C2', visible: true, exportSettings: [{ format: 'PNG' }], children: [] },
        ],
      },
    ]);
    const roles = annotateExportTree(frame);
    const parentRole = roles.get('parent-export');
    expect(parentRole?.role).toBe('exportRoot');
    if (parentRole && 'rasterize' in parentRole) {
      expect(parentRole.rasterize).toBe(false);
    }
  });

  it('keeps exported container rasterized when direct children are mixed export/non-export', () => {
    const frame = mockFrame([
      {
        type: 'GROUP',
        id: 'parent-export',
        name: 'ParentExport',
        visible: true,
        exportSettings: [{ format: 'PNG' }],
        children: [
          { type: 'GROUP', id: 'c1', name: 'C1', visible: true, exportSettings: [{ format: 'PNG' }], children: [] },
          { type: 'RECTANGLE', id: 'plain-child', name: 'PlainChild', visible: true, children: [] },
        ],
      },
    ]);
    const roles = annotateExportTree(frame);
    const parentRole = roles.get('parent-export');
    expect(parentRole?.role).toBe('exportRoot');
    if (parentRole && 'rasterize' in parentRole) {
      expect(parentRole.rasterize).toBe(true);
    }
  });

  it('does not rasterize parent when non-export direct child only wraps deeper exports (transparent-PNG fix)', () => {
    const frame = mockFrame([
      {
        type: 'GROUP',
        id: 'A',
        name: 'A',
        visible: true,
        exportSettings: [{ format: 'PNG' }],
        children: [
          { type: 'TEXT', id: 'B', name: 'B', visible: true, exportSettings: [{ format: 'PNG' }], children: [] },
          {
            type: 'GROUP',
            id: 'C',
            name: 'C',
            visible: true,
            children: [
              { type: 'GROUP', id: 'D', name: 'D', visible: true, exportSettings: [{ format: 'PNG' }], children: [] },
              { type: 'GROUP', id: 'E', name: 'E', visible: true, exportSettings: [{ format: 'PNG' }], children: [] },
            ],
          },
        ],
      },
    ]);
    const roles = annotateExportTree(frame);
    const a = roles.get('A');
    expect(a?.role).toBe('exportRoot');
    if (a && 'rasterize' in a) {
      expect(a.rasterize).toBe(false);
    }
    expect(roles.get('C')?.role).toBe('passthrough');
    expect(roles.get('D')?.role).toBe('childExport');
    expect(roles.get('E')?.role).toBe('childExport');
  });
});

describe('collectNodesToHideForExport', () => {
  it('collects labels and child exports for hiding', () => {
    const frame = mockFrame([
      {
        type: 'GROUP', id: 'root-export', name: 'RootExport', visible: true,
        exportSettings: [{ format: 'PNG' }],
        children: [
          { type: 'GROUP', id: 'child-export', name: 'ChildExport', visible: true, exportSettings: [{ format: 'PNG' }], children: [] },
          { type: 'TEXT', id: 'label-text', name: 'LabelText', visible: true, exportSettings: [{ format: 'PNG' }], children: [] },
          { type: 'RECTANGLE', id: 'normal', name: 'Normal', visible: true, children: [] },
        ],
      },
    ]);
    const roles = annotateExportTree(frame);
    const rootExport = (frame as unknown as MockNode).children![0] as unknown as SceneNode;
    const toHide = collectNodesToHideForExport(rootExport, roles);
    const ids = toHide.map((n) => n.id);
    expect(ids).toContain('child-export');
    expect(ids).toContain('label-text');
    expect(ids).not.toContain('normal');
  });
});

describe('collectRasterNodes', () => {
  it('returns all nodes that need PNG export', () => {
    const frame = mockFrame([
      {
        type: 'GROUP', id: 'root-export', name: 'RootExport', visible: true,
        exportSettings: [{ format: 'PNG' }],
        children: [
          { type: 'GROUP', id: 'child-export', name: 'ChildExport', visible: true, exportSettings: [{ format: 'PNG' }], children: [] },
          { type: 'TEXT', id: 'label-text', name: 'LabelText', visible: true, exportSettings: [{ format: 'PNG' }], children: [] },
          { type: 'RECTANGLE', id: 'plain-child', name: 'PlainChild', visible: true, children: [] },
        ],
      },
    ]);
    const roles = annotateExportTree(frame);
    const rasterNodes = collectRasterNodes(frame, roles);
    const ids = rasterNodes.map((n) => n.id);
    expect(ids).toContain('root-export');
    expect(ids).toContain('child-export');
    expect(ids).not.toContain('label-text');
  });

  it('skips parent raster when exported parent has only exported children', () => {
    const frame = mockFrame([
      {
        type: 'GROUP',
        id: 'parent-export',
        name: 'ParentExport',
        visible: true,
        exportSettings: [{ format: 'PNG' }],
        children: [
          { type: 'GROUP', id: 'c1', name: 'C1', visible: true, exportSettings: [{ format: 'PNG' }], children: [] },
          { type: 'GROUP', id: 'c2', name: 'C2', visible: true, exportSettings: [{ format: 'PNG' }], children: [] },
        ],
      },
    ]);
    const roles = annotateExportTree(frame);
    const rasterNodes = collectRasterNodes(frame, roles);
    const ids = rasterNodes.map((n) => n.id);
    expect(ids).not.toContain('parent-export');
    expect(ids).toContain('c1');
    expect(ids).toContain('c2');
  });

  it('includes parent raster when exported parent has mixed direct children', () => {
    const frame = mockFrame([
      {
        type: 'GROUP',
        id: 'parent-export',
        name: 'ParentExport',
        visible: true,
        exportSettings: [{ format: 'PNG' }],
        children: [
          { type: 'GROUP', id: 'c1', name: 'C1', visible: true, exportSettings: [{ format: 'PNG' }], children: [] },
          { type: 'RECTANGLE', id: 'plain-child', name: 'PlainChild', visible: true, children: [] },
        ],
      },
    ]);
    const roles = annotateExportTree(frame);
    const rasterNodes = collectRasterNodes(frame, roles);
    const ids = rasterNodes.map((n) => n.id);
    expect(ids).toContain('parent-export');
    expect(ids).toContain('c1');
  });

  it('excludes parent raster when passthrough sibling wraps only deeper exports', () => {
    const frame = mockFrame([
      {
        type: 'GROUP',
        id: 'A',
        name: 'A',
        visible: true,
        exportSettings: [{ format: 'PNG' }],
        children: [
          { type: 'TEXT', id: 'B', name: 'B', visible: true, exportSettings: [{ format: 'PNG' }], children: [] },
          {
            type: 'GROUP',
            id: 'C',
            name: 'C',
            visible: true,
            children: [
              { type: 'GROUP', id: 'D', name: 'D', visible: true, exportSettings: [{ format: 'PNG' }], children: [] },
              { type: 'GROUP', id: 'E', name: 'E', visible: true, exportSettings: [{ format: 'PNG' }], children: [] },
            ],
          },
        ],
      },
    ]);
    const roles = annotateExportTree(frame);
    const rasterNodes = collectRasterNodes(frame, roles);
    const ids = rasterNodes.map((n) => n.id);
    expect(ids).not.toContain('A');
    expect(ids).toContain('D');
    expect(ids).toContain('E');
    expect(ids).not.toContain('B');
  });
});

