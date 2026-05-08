import { describe, it, expect } from 'vitest';
import { ReportCollector } from '../src/pipeline/report';
import { mapAutoLayoutToIr } from '../src/domain/discovery/layoutMap';
import { buildFrameIr } from '../src/domain/ir/builder';
import { annotateExportTree } from '../src/domain/discovery/annotate';

type AutoLayoutNode = SceneNode & ChildrenMixin & AutoLayoutMixin;

function baseAutoLayout(overrides: Partial<Record<string, unknown>> = {}): AutoLayoutNode {
  const base = {
    type: 'FRAME',
    id: 'al-frame',
    name: 'AutoFrame',
    visible: true,
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    layoutMode: 'HORIZONTAL',
    paddingLeft: 4,
    paddingRight: 5,
    paddingTop: 6,
    paddingBottom: 7,
    itemSpacing: 10,
    primaryAxisAlignItems: 'MIN',
    counterAxisAlignItems: 'MIN',
    primaryAxisSizingMode: 'FIXED',
    counterAxisSizingMode: 'FIXED',
    layoutWrap: 'NO_WRAP',
    strokesIncludedInLayout: false,
    counterAxisAlignContent: 'AUTO',
    counterAxisSpacing: 0,
    itemReverseZIndex: false,
    horizontalPadding: 0,
    verticalPadding: 0,
    layoutSizingHorizontal: 'FIXED',
    layoutSizingVertical: 'FIXED',
    children: [],
    ...overrides,
  };
  return base as unknown as AutoLayoutNode;
}

describe('mapAutoLayoutToIr', () => {
  it('returns undefined when layoutMode is NONE', () => {
    const node = baseAutoLayout({ layoutMode: 'NONE' });
    const report = new ReportCollector();
    expect(mapAutoLayoutToIr(node, report)).toBeUndefined();
    expect(report.getEntries()).toHaveLength(0);
  });

  it('returns undefined for GRID and reports', () => {
    const node = baseAutoLayout({ layoutMode: 'GRID' });
    const report = new ReportCollector();
    expect(mapAutoLayoutToIr(node, report)).toBeUndefined();
    const entries = report.getEntries();
    expect(entries.some((e) => e.message.includes('layoutMode=GRID'))).toBe(true);
  });

  it('maps HORIZONTAL auto layout to row flex with padding and gap', () => {
    const node = baseAutoLayout();
    const report = new ReportCollector();
    const layout = mapAutoLayoutToIr(node, report);
    expect(layout).toEqual({
      type: 'flex',
      direction: 'row',
      gap: 10,
      padding: { left: 4, right: 5, top: 6, bottom: 7 },
    });
    expect(report.getEntries()).toHaveLength(0);
  });

  it('maps VERTICAL auto layout to column flex', () => {
    const node = baseAutoLayout({ layoutMode: 'VERTICAL' });
    const report = new ReportCollector();
    const layout = mapAutoLayoutToIr(node, report);
    expect(layout?.direction).toBe('column');
  });

  it('reports unsupported primaryAxisAlignItems but still returns flex subset', () => {
    const node = baseAutoLayout({ primaryAxisAlignItems: 'CENTER' });
    const report = new ReportCollector();
    const layout = mapAutoLayoutToIr(node, report);
    expect(layout).toBeDefined();
    expect(report.getEntries().some((e) => e.message.includes('primaryAxisAlignItems=CENTER'))).toBe(true);
  });

  it('reports child layoutGrow', () => {
    const child = {
      type: 'RECTANGLE',
      id: 'child-grow',
      name: 'C',
      visible: true,
      layoutGrow: 1,
      layoutAlign: 'INHERIT',
      layoutPositioning: 'AUTO',
    };
    const node = baseAutoLayout({
      children: [child],
    });
    const report = new ReportCollector();
    mapAutoLayoutToIr(node, report);
    expect(report.getEntries().some((e) => e.message.includes('layoutGrow=1'))).toBe(true);
  });
});

describe('buildIr auto layout integration', () => {
  it('attaches layout on frame export roots with auto layout', () => {
    const frame = {
      type: 'FRAME',
      id: 'frame-1',
      name: 'Main',
      width: 200,
      height: 200,
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
      absoluteTransform: [
        [1, 0, 0],
        [0, 1, 0],
      ],
      children: [],
    } as unknown as FrameNode;

    const exportRoot = baseAutoLayout({
      id: 'export-root',
      name: 'Root',
      x: 0,
      y: 0,
      width: 120,
      height: 40,
      exportSettings: [{ format: 'PNG' }],
      absoluteBoundingBox: { x: 10, y: 20, width: 120, height: 40 },
      absoluteTransform: [
        [1, 0, 10],
        [0, 1, 20],
      ],
    });

    (frame as unknown as { children: unknown[] }).children = [exportRoot];
    (exportRoot as unknown as { parent: unknown }).parent = frame;
    const report = new ReportCollector();
    const roles = annotateExportTree(frame);
    const irFrame = buildFrameIr(frame, roles, report);
    const mapped = irFrame.children[0];
    expect(mapped.kind).toBe('container');
    if (mapped.kind !== 'container') {
      return;
    }
    expect(mapped.layout).toEqual({
      type: 'flex',
      direction: 'row',
      gap: 10,
      padding: { left: 4, right: 5, top: 6, bottom: 7 },
    });
  });
});
