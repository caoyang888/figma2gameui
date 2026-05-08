import { describe, it, expect } from 'vitest';
import { ReportCollector } from '../src/pipeline/report';
import { buildFrameIr } from '../src/domain/ir/builder';
import { annotateExportTree, collectNodesToHideForExport } from '../src/domain/discovery/annotate';
import type { IrContainer } from '../src/domain/ir/schema';

function mockFrame(overrides: Record<string, unknown> = {}): FrameNode {
  return {
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
    ...overrides,
  } as unknown as FrameNode;
}

function mockExportRoot(): SceneNode {
  const root = {
    type: 'GROUP',
    id: 'export-root',
    name: 'ExportRoot',
    x: 5,
    y: 6,
    width: 80,
    height: 40,
    visible: true,
    absoluteBoundingBox: { x: 50, y: 60, width: 80, height: 40 },
    absoluteTransform: [
      [1, 0, 50],
      [0, 1, 60],
    ],
    exportSettings: [{ format: 'PNG' }],
    children: [
      {
        type: 'RECTANGLE',
        id: 'inner-rect',
        name: 'Inner',
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        visible: true,
        exportSettings: [{ format: 'PNG' }],
        children: [],
        parent: null,
      },
      {
        type: 'RECTANGLE',
        id: 'inner-plain',
        name: 'InnerPlain',
        x: 12,
        y: 2,
        width: 8,
        height: 8,
        visible: true,
        children: [],
        parent: null,
      },
    ],
  } as unknown as SceneNode;
  const children = (root as unknown as { children: SceneNode[] }).children as (SceneNode & { parent: BaseNode | null })[];
  for (const child of children) {
  child.parent = root as unknown as BaseNode;
  }
  return root;
}

describe('buildFrameIr', () => {
  it('maps each export root directly to frame-local placement without __align__ wrappers', () => {
    const exportRoot = mockExportRoot();
    const frame = mockFrame({ children: [exportRoot] });
    (exportRoot as unknown as { parent: unknown }).parent = frame;
    const report = new ReportCollector();
    const roles = annotateExportTree(frame);
    const irFrame = buildFrameIr(frame, roles, report);

    expect(irFrame.children).toHaveLength(1);
    expect(irFrame.width).toBe(200);
    expect(irFrame.height).toBe(200);
    const root = irFrame.children[0];
    expect(root.kind).toBe('container');
    if (root.kind !== 'container') {
      return;
    }
    expect(root.id).toBe('export-root');
    expect(root.placement.x).toBe(50);
    expect(root.placement.y).toBe(60);
    expect(root.placement.width).toBe(80);
    expect(root.placement.height).toBe(40);
    if (root.kind === 'container') {
      const childIds = root.children.map((n) => n.id);
      expect(childIds).toContain('export-root:export');
      expect(childIds).toContain('inner-rect:export');
    }
  });

  it('when export settings are on the Frame root, IR still includes nested export children', () => {
    const inner = {
      type: 'GROUP',
      id: 'g',
      name: 'G',
      visible: true,
      width: 10,
      height: 10,
      exportSettings: [{ format: 'PNG' }],
      absoluteBoundingBox: { x: 5, y: 5, width: 10, height: 10 },
      children: [],
    } as unknown as SceneNode;
    const frame = mockFrame({ children: [inner] });
    (frame as unknown as { exportSettings: unknown[] }).exportSettings = [{ format: 'PNG' }];
    (inner as unknown as { parent: unknown }).parent = frame;

    const report = new ReportCollector();
    const roles = annotateExportTree(frame);
    expect(roles.get('frame-1')?.role).toBe('exportRoot');
    expect(roles.get('g')?.role).toBe('childExport');

    const irFrame = buildFrameIr(frame, roles, report);
    expect(irFrame.children).toHaveLength(1);
    const root = irFrame.children[0];
    expect(root?.kind).toBe('container');
    if (root?.kind !== 'container') {
      return;
    }
    expect(root.id).toBe('frame-1');
    expect(root.children.map((n) => n.id)).toContain('g:export');
  });

  it('does not emit Label for text without export under exported parent', () => {
    const exportRoot = {
      type: 'GROUP',
      id: 'group-export',
      name: 'GroupExport',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      visible: true,
      exportSettings: [{ format: 'PNG' }],
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 50 },
      absoluteTransform: [
        [1, 0, 0],
        [0, 1, 0],
      ],
      children: [
        {
          type: 'TEXT',
          id: 'text-child',
          name: 'Title',
          x: 10,
          y: 8,
          width: 60,
          height: 20,
          visible: true,
          characters: 'Hello',
          fontName: { family: 'Inter', style: 'Regular' },
          fontSize: 16,
          fills: [],
          children: [],
          parent: null,
        },
      ],
    } as unknown as SceneNode;
    const text = (exportRoot as unknown as { children: SceneNode[] }).children[0] as SceneNode & { parent: BaseNode | null };
    text.parent = exportRoot as unknown as BaseNode;
    const frame = mockFrame({ children: [exportRoot] });
    (exportRoot as unknown as { parent: unknown }).parent = frame;
    const report = new ReportCollector();
    const roles = annotateExportTree(frame);

    const irFrame = buildFrameIr(frame, roles, report);
    const root = irFrame.children[0];
    expect(root?.kind).toBe('container');
    if (!root || root.kind !== 'container') return;
    expect(root.children.some((n) => n.kind === 'text')).toBe(false);
    expect(root.children.some((n) => n.kind === 'sprite')).toBe(true);
  });

  it('maps text export root as sprite placeholder instead of Label', () => {
    const textExportRoot = {
      type: 'TEXT',
      id: 'text-export-root',
      name: 'TitleText',
      x: 10,
      y: 6,
      width: 80,
      height: 24,
      visible: true,
      exportSettings: [{ format: 'PNG' }],
      absoluteBoundingBox: { x: 10, y: 6, width: 80, height: 24 },
      absoluteTransform: [
        [1, 0, 10],
        [0, 1, 6],
      ],
      characters: 'Exported',
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 16,
      fills: [],
    } as unknown as SceneNode;
    const frame = mockFrame({ children: [textExportRoot] });
    (textExportRoot as unknown as { parent: unknown }).parent = frame;
    const report = new ReportCollector();
    const roles = annotateExportTree(frame);

    const irFrame = buildFrameIr(frame, roles, report);
    expect(irFrame.children).toHaveLength(1);
    const node = irFrame.children[0];
    expect(node?.kind).toBe('sprite');
  });

  it('emits Label for text with export under exported parent, coordinates relative to export root', () => {
    const exportRoot = {
      type: 'GROUP',
      id: 'group-export-2',
      name: 'GroupExport2',
      x: 20,
      y: 30,
      width: 100,
      height: 50,
      visible: true,
      exportSettings: [{ format: 'PNG' }],
      absoluteBoundingBox: { x: 20, y: 30, width: 100, height: 50 },
      absoluteTransform: [
        [1, 0, 20],
        [0, 1, 30],
      ],
      children: [
        {
          type: 'TEXT',
          id: 'text-child-export',
          name: 'TitleExport',
          x: 10,
          y: 8,
          width: 60,
          height: 20,
          visible: true,
          characters: 'Hello Label',
          exportSettings: [{ format: 'PNG' }],
          absoluteBoundingBox: { x: 30, y: 38, width: 60, height: 20 },
          fontName: { family: 'Inter', style: 'Regular' },
          fontSize: 16,
          fills: [],
          children: [],
          parent: null,
        },
      ],
    } as unknown as SceneNode;
    const text = (exportRoot as unknown as { children: SceneNode[] }).children[0] as SceneNode & { parent: BaseNode | null };
    text.parent = exportRoot as unknown as BaseNode;
    const frame = mockFrame({ children: [exportRoot] });
    (exportRoot as unknown as { parent: unknown }).parent = frame;
    const report = new ReportCollector();
    const roles = annotateExportTree(frame);

    const irFrame = buildFrameIr(frame, roles, report);
    const root = irFrame.children[0];
    expect(root?.kind).toBe('container');
    if (!root || root.kind !== 'container') return;
    const labelNode = root.children.find((n) => n.kind === 'text');
    expect(labelNode).toBeDefined();
    expect(labelNode!.placement.x).toBe(10);
    expect(labelNode!.placement.y).toBe(8);
    expect(labelNode!.placement.width).toBe(60);
    expect(labelNode!.placement.height).toBe(20);
  });

  it('emits Label with correct coords when text is nested multiple levels deep', () => {
    const textChild = {
      type: 'TEXT',
      id: 'deep-text',
      name: 'DeepLabel',
      x: 5,
      y: 3,
      width: 40,
      height: 14,
      visible: true,
      characters: 'Nested',
      exportSettings: [{ format: 'PNG' }],
      absoluteBoundingBox: { x: 75, y: 53, width: 40, height: 14 },
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 12,
      fills: [],
      children: [],
      parent: null,
    };
    const middleContainer = {
      type: 'FRAME',
      id: 'middle',
      name: 'Middle',
      x: 30,
      y: 20,
      width: 50,
      height: 30,
      visible: true,
      absoluteBoundingBox: { x: 70, y: 50, width: 50, height: 30 },
      absoluteTransform: [[1, 0, 70], [0, 1, 50]],
      children: [textChild],
    };
    textChild.parent = middleContainer as unknown as BaseNode;
    const exportRoot = {
      type: 'GROUP',
      id: 'root-group',
      name: 'RootGroup',
      x: 40,
      y: 30,
      width: 120,
      height: 80,
      visible: true,
      exportSettings: [{ format: 'PNG' }],
      absoluteBoundingBox: { x: 40, y: 30, width: 120, height: 80 },
      absoluteTransform: [[1, 0, 40], [0, 1, 30]],
      children: [middleContainer],
    } as unknown as SceneNode;
    (middleContainer as unknown as { parent: BaseNode | null }).parent = exportRoot as unknown as BaseNode;
    const frame = mockFrame({ children: [exportRoot] });
    (exportRoot as unknown as { parent: unknown }).parent = frame;
    const report = new ReportCollector();
    const roles = annotateExportTree(frame);

    const irFrame = buildFrameIr(frame, roles, report);
    const root = irFrame.children[0];
    expect(root?.kind).toBe('container');
    if (!root || root.kind !== 'container') return;
    const label = root.children.find((n) => n.kind === 'text');
    expect(label).toBeDefined();
    expect(label!.placement.x).toBe(35);
    expect(label!.placement.y).toBe(23);
  });

  it('nested export: Group1(export) > Group2(export) -> Group2 as child sprite', () => {
    const innerGroup = {
      type: 'GROUP', id: 'g2', name: 'G2',
      x: 10, y: 5, width: 30, height: 20, visible: true,
      exportSettings: [{ format: 'PNG' }],
      absoluteBoundingBox: { x: 60, y: 45, width: 30, height: 20 },
      absoluteTransform: [[1, 0, 60], [0, 1, 45]],
      children: [],
    };
    const outerGroup = {
      type: 'GROUP', id: 'g1', name: 'G1',
      x: 50, y: 40, width: 80, height: 60, visible: true,
      exportSettings: [{ format: 'PNG' }],
      absoluteBoundingBox: { x: 50, y: 40, width: 80, height: 60 },
      absoluteTransform: [[1, 0, 50], [0, 1, 40]],
      children: [innerGroup],
    } as unknown as SceneNode;
    (innerGroup as unknown as { parent: unknown }).parent = outerGroup;
    const frame = mockFrame({ children: [outerGroup] });
    (outerGroup as unknown as { parent: unknown }).parent = frame;

    const roles = annotateExportTree(frame);
    expect(roles.get('g1')?.role).toBe('exportRoot');
    expect(roles.get('g2')?.role).toBe('childExport');

    const report = new ReportCollector();
    const irFrame = buildFrameIr(frame, roles, report);
    const root = irFrame.children[0] as IrContainer;
    expect(root.kind).toBe('container');
    const g2Sprite = root.children.find((n) => n.id === 'g2:export');
    expect(g2Sprite).toBeDefined();
    expect(g2Sprite!.kind).toBe('sprite');
    expect(g2Sprite!.placement.x).toBe(10);
    expect(g2Sprite!.placement.y).toBe(5);
  });

  it('passthrough: Container(no export) > Group(export) -> Container retained', () => {
    const innerExport = {
      type: 'GROUP', id: 'inner-exp', name: 'InnerExport',
      x: 5, y: 5, width: 20, height: 15, visible: true,
      exportSettings: [{ format: 'PNG' }],
      absoluteBoundingBox: { x: 55, y: 55, width: 20, height: 15 },
      children: [],
    };
    const passContainer = {
      type: 'FRAME', id: 'pass', name: 'PassContainer',
      x: 0, y: 0, width: 40, height: 30, visible: true,
      absoluteBoundingBox: { x: 50, y: 50, width: 40, height: 30 },
      absoluteTransform: [[1, 0, 50], [0, 1, 50]],
      children: [innerExport],
    };
    (innerExport as unknown as { parent: unknown }).parent = passContainer;
    const exportRoot = {
      type: 'GROUP', id: 'top-exp', name: 'TopExport',
      x: 50, y: 50, width: 80, height: 60, visible: true,
      exportSettings: [{ format: 'PNG' }],
      absoluteBoundingBox: { x: 50, y: 50, width: 80, height: 60 },
      absoluteTransform: [[1, 0, 50], [0, 1, 50]],
      children: [passContainer],
    } as unknown as SceneNode;
    (passContainer as unknown as { parent: unknown }).parent = exportRoot;
    const frame = mockFrame({ children: [exportRoot] });
    (exportRoot as unknown as { parent: unknown }).parent = frame;

    const roles = annotateExportTree(frame);
    expect(roles.get('pass')?.role).toBe('passthrough');

    const report = new ReportCollector();
    const irFrame = buildFrameIr(frame, roles, report);
    const root = irFrame.children[0] as IrContainer;
    const passNode = root.children.find((n) => n.id === 'pass');
    expect(passNode).toBeDefined();
    expect(passNode!.kind).toBe('container');
    const passChildren = (passNode as IrContainer).children;
    expect(passChildren.some((n) => n.id === 'inner-exp:export')).toBe(true);
  });

  it('pruned: empty container with no export descendants is not in IR', () => {
    const emptyGroup = {
      type: 'GROUP', id: 'empty', name: 'EmptyGroup',
      x: 10, y: 10, width: 40, height: 30, visible: true,
      children: [
        { type: 'RECTANGLE', id: 'r1', name: 'Rect', x: 0, y: 0, width: 10, height: 10, visible: true, children: [] },
      ],
    };
    (emptyGroup.children[0] as unknown as { parent: unknown }).parent = emptyGroup;
    const exportRoot = {
      type: 'GROUP', id: 'exp-root', name: 'ExpRoot',
      x: 0, y: 0, width: 100, height: 80, visible: true,
      exportSettings: [{ format: 'PNG' }],
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 80 },
      absoluteTransform: [[1, 0, 0], [0, 1, 0]],
      children: [emptyGroup],
    } as unknown as SceneNode;
    (emptyGroup as unknown as { parent: unknown }).parent = exportRoot;
    const frame = mockFrame({ children: [exportRoot] });
    (exportRoot as unknown as { parent: unknown }).parent = frame;

    const roles = annotateExportTree(frame);
    expect(roles.get('empty')?.role).toBe('pruned');

    const report = new ReportCollector();
    const irFrame = buildFrameIr(frame, roles, report);
    const root = irFrame.children[0] as IrContainer;
    expect(root.children.find((n) => n.id === 'empty')).toBeUndefined();
  });

  it('TEXT without export ancestor is exported as independent sprite', () => {
    const textNode = {
      type: 'TEXT', id: 'standalone-text', name: 'StandaloneText',
      x: 20, y: 10, width: 60, height: 18, visible: true,
      exportSettings: [{ format: 'PNG' }],
      absoluteBoundingBox: { x: 20, y: 10, width: 60, height: 18 },
      absoluteTransform: [[1, 0, 20], [0, 1, 10]],
      characters: 'Standalone',
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 14, fills: [],
    } as unknown as SceneNode;
    const frame = mockFrame({ children: [textNode] });
    (textNode as unknown as { parent: unknown }).parent = frame;

    const roles = annotateExportTree(frame);
    expect(roles.get('standalone-text')?.role).toBe('exportRoot');

    const report = new ReportCollector();
    const irFrame = buildFrameIr(frame, roles, report);
    expect(irFrame.children).toHaveLength(1);
    expect(irFrame.children[0].kind).toBe('sprite');
  });

  it('frame-level passthrough: Container(no export) > Group1(export), Group2(export) retains Container', () => {
    const g1 = {
      type: 'GROUP', id: 'g1', name: 'G1',
      x: 0, y: 0, width: 40, height: 30, visible: true,
      exportSettings: [{ format: 'PNG' }],
      absoluteBoundingBox: { x: 10, y: 20, width: 40, height: 30 },
      absoluteTransform: [[1, 0, 10], [0, 1, 20]],
      children: [],
    };
    const g2 = {
      type: 'GROUP', id: 'g2', name: 'G2',
      x: 50, y: 0, width: 30, height: 25, visible: true,
      exportSettings: [{ format: 'PNG' }],
      absoluteBoundingBox: { x: 60, y: 20, width: 30, height: 25 },
      absoluteTransform: [[1, 0, 60], [0, 1, 20]],
      children: [],
    };
    const container = {
      type: 'FRAME', id: 'container', name: 'Container',
      x: 10, y: 20, width: 100, height: 50, visible: true,
      absoluteBoundingBox: { x: 10, y: 20, width: 100, height: 50 },
      absoluteTransform: [[1, 0, 10], [0, 1, 20]],
      children: [g1, g2],
    };
    (g1 as unknown as { parent: unknown }).parent = container;
    (g2 as unknown as { parent: unknown }).parent = container;
    const frame = mockFrame({ children: [container] });
    (container as unknown as { parent: unknown }).parent = frame;

    const roles = annotateExportTree(frame);
    expect(roles.get('container')?.role).toBe('passthrough');
    expect(roles.get('g1')?.role).toBe('exportRoot');
    expect(roles.get('g2')?.role).toBe('exportRoot');

    const report = new ReportCollector();
    const irFrame = buildFrameIr(frame, roles, report);

    expect(irFrame.children).toHaveLength(1);
    const containerNode = irFrame.children[0];
    expect(containerNode.kind).toBe('container');
    expect(containerNode.id).toBe('container');
    if (containerNode.kind !== 'container') return;
    expect(containerNode.children).toHaveLength(2);
    const childIds = containerNode.children.map((n) => n.id);
    expect(childIds).toContain('g1');
    expect(childIds).toContain('g2');
  });

  it('exported container with all exported direct children keeps hierarchy but has no self sprite', () => {
    const childA = {
      type: 'GROUP', id: 'child-a', name: 'ChildA',
      x: 10, y: 8, width: 30, height: 20, visible: true,
      exportSettings: [{ format: 'PNG' }],
      absoluteBoundingBox: { x: 20, y: 18, width: 30, height: 20 },
      children: [],
    };
    const childB = {
      type: 'GROUP', id: 'child-b', name: 'ChildB',
      x: 50, y: 10, width: 25, height: 18, visible: true,
      exportSettings: [{ format: 'PNG' }],
      absoluteBoundingBox: { x: 60, y: 20, width: 25, height: 18 },
      children: [],
    };
    const parent = {
      type: 'GROUP', id: 'parent', name: 'Parent',
      x: 10, y: 10, width: 100, height: 60, visible: true,
      exportSettings: [{ format: 'PNG' }],
      absoluteBoundingBox: { x: 10, y: 10, width: 100, height: 60 },
      absoluteTransform: [[1, 0, 10], [0, 1, 10]],
      children: [childA, childB],
    } as unknown as SceneNode;
    (childA as unknown as { parent: unknown }).parent = parent;
    (childB as unknown as { parent: unknown }).parent = parent;
    const frame = mockFrame({ children: [parent] });
    (parent as unknown as { parent: unknown }).parent = frame;

    const roles = annotateExportTree(frame);
    const report = new ReportCollector();
    const irFrame = buildFrameIr(frame, roles, report);
    const root = irFrame.children[0];
    expect(root?.kind).toBe('container');
    if (!root || root.kind !== 'container') return;

    expect(root.children.some((n) => n.id === 'parent:export')).toBe(false);
    expect(root.children.some((n) => n.id === 'child-a:export')).toBe(true);
    expect(root.children.some((n) => n.id === 'child-b:export')).toBe(true);
  });

  it('collectNodesToHideForExport hides labels and child exports for raster', () => {
    const textChild = {
      type: 'TEXT', id: 'label-t', name: 'LabelT',
      x: 5, y: 5, width: 30, height: 12, visible: true,
      exportSettings: [{ format: 'PNG' }],
      absoluteBoundingBox: { x: 55, y: 55, width: 30, height: 12 },
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 12, fills: [], children: [],
    };
    const childExport = {
      type: 'GROUP', id: 'child-exp', name: 'ChildExp',
      x: 40, y: 10, width: 20, height: 15, visible: true,
      exportSettings: [{ format: 'PNG' }],
      absoluteBoundingBox: { x: 90, y: 60, width: 20, height: 15 },
      children: [],
    };
    const normalRect = {
      type: 'RECTANGLE', id: 'normal-r', name: 'Normal',
      x: 0, y: 0, width: 10, height: 10, visible: true, children: [],
    };
    const exportRoot = {
      type: 'GROUP', id: 'exp-r', name: 'ExpR',
      x: 50, y: 50, width: 100, height: 70, visible: true,
      exportSettings: [{ format: 'PNG' }],
      absoluteBoundingBox: { x: 50, y: 50, width: 100, height: 70 },
      children: [textChild, childExport, normalRect],
    } as unknown as SceneNode;
    (textChild as unknown as { parent: unknown }).parent = exportRoot;
    (childExport as unknown as { parent: unknown }).parent = exportRoot;
    (normalRect as unknown as { parent: unknown }).parent = exportRoot;
    const frame = mockFrame({ children: [exportRoot] });
    (exportRoot as unknown as { parent: unknown }).parent = frame;

    const roles = annotateExportTree(frame);
    const toHide = collectNodesToHideForExport(exportRoot, roles);
    const hiddenIds = toHide.map((n) => n.id);
    expect(hiddenIds).toContain('label-t');
    expect(hiddenIds).toContain('child-exp');
    expect(hiddenIds).not.toContain('normal-r');
  });

  it('attaches constraints spec into node extensions when FRAME has constraints', () => {
    const exportRoot = {
      type: 'FRAME',
      id: 'exp-cst',
      name: 'ExpCst',
      x: 10,
      y: 20,
      width: 100,
      height: 80,
      visible: true,
      constraints: { horizontal: 'LEFT_RIGHT', vertical: 'TOP_BOTTOM' },
      exportSettings: [{ format: 'PNG' }],
      absoluteBoundingBox: { x: 10, y: 20, width: 100, height: 80 },
      absoluteTransform: [[1, 0, 10], [0, 1, 20]],
      children: [],
    } as unknown as SceneNode;
    const frame = mockFrame({ children: [exportRoot] });
    (exportRoot as unknown as { parent: unknown }).parent = frame;

    const roles = annotateExportTree(frame);
    const report = new ReportCollector();
    const irFrame = buildFrameIr(frame, roles, report);

    expect(irFrame.children).toHaveLength(1);
    const node = irFrame.children[0];
    expect(node.extensions).toHaveProperty('constraints');
    const constraints = node.extensions.constraints as {
      horizontal: string;
      vertical: string;
      widgetNumbers?: { left: number; top: number; right: number; bottom: number };
    };
    expect(constraints.horizontal).toBe('stretch');
    expect(constraints.vertical).toBe('stretch');
    expect(constraints.widgetNumbers).toBeDefined();
    expect(constraints.widgetNumbers?.left).toBe(10);
    expect(constraints.widgetNumbers?.top).toBe(20);
    expect(constraints.widgetNumbers?.right).toBe(90);
    expect(constraints.widgetNumbers?.bottom).toBe(100);
  });

  it('does not attach constraints to synthetic export placeholder sprite', () => {
    const exportRoot = {
      type: 'FRAME',
      id: 'exp-placeholder',
      name: 'ExpPlaceholder',
      x: 10,
      y: 20,
      width: 100,
      height: 80,
      visible: true,
      constraints: { horizontal: 'STRETCH', vertical: 'STRETCH' },
      exportSettings: [{ format: 'PNG' }],
      absoluteBoundingBox: { x: 10, y: 20, width: 100, height: 80 },
      absoluteTransform: [[1, 0, 10], [0, 1, 20]],
      children: [],
    } as unknown as SceneNode;
    const frame = mockFrame({ children: [exportRoot] });
    (exportRoot as unknown as { parent: unknown }).parent = frame;
    const report = new ReportCollector();
    const roles = annotateExportTree(frame);
    const irFrame = buildFrameIr(frame, roles, report);
    const root = irFrame.children[0];
    expect(root?.kind).toBe('container');
    if (!root || root.kind !== 'container') return;
    const placeholder = root.children.find((n) => n.id === 'exp-placeholder:export');
    expect(placeholder).toBeDefined();
    expect((placeholder!.extensions as Record<string, unknown>).constraints).toBeUndefined();
  });

  it('for non-frame A->B->C chain, no node gets constraints extension', () => {
    const nodeC = {
      type: 'GROUP',
      id: 'C',
      name: 'C',
      x: 5,
      y: 5,
      width: 20,
      height: 20,
      visible: true,
      constraints: { horizontal: 'MIN', vertical: 'MIN' },
      absoluteBoundingBox: { x: 25, y: 25, width: 20, height: 20 },
      children: [],
    };
    const nodeB = {
      type: 'GROUP',
      id: 'B',
      name: 'B',
      x: 10,
      y: 10,
      width: 50,
      height: 50,
      visible: true,
      constraints: { horizontal: 'MIN', vertical: 'MIN' },
      absoluteBoundingBox: { x: 20, y: 20, width: 50, height: 50 },
      children: [nodeC],
    };
    (nodeC as unknown as { parent: unknown }).parent = nodeB;
    const nodeA = {
      type: 'GROUP',
      id: 'A',
      name: 'A',
      x: 10,
      y: 10,
      width: 100,
      height: 100,
      visible: true,
      constraints: { horizontal: 'MIN', vertical: 'MIN' },
      exportSettings: [{ format: 'PNG' }],
      absoluteBoundingBox: { x: 10, y: 10, width: 100, height: 100 },
      absoluteTransform: [[1, 0, 10], [0, 1, 10]],
      children: [nodeB],
    } as unknown as SceneNode;
    (nodeB as unknown as { parent: unknown }).parent = nodeA;
    const frame = mockFrame({ children: [nodeA] });
    (nodeA as unknown as { parent: unknown }).parent = frame;

    const report = new ReportCollector();
    const roles = annotateExportTree(frame);
    const irFrame = buildFrameIr(frame, roles, report);
    const aNode = irFrame.children[0];
    expect(aNode?.kind).toBe('container');
    if (!aNode || aNode.kind !== 'container') return;
    const bNode = aNode.children.find((n) => n.id === 'B');
    const cNode = bNode && bNode.kind === 'container' ? bNode.children.find((n) => n.id === 'C') : undefined;

    expect((aNode.extensions as Record<string, unknown>).constraints).toBeUndefined();
    expect((bNode?.extensions as Record<string, unknown> | undefined)?.constraints).toBeUndefined();
    expect((cNode?.extensions as Record<string, unknown> | undefined)?.constraints).toBeUndefined();
  });

  it('does not promote child constraints for non-frame wrapper', () => {
    const nodeC = {
      type: 'GROUP',
      id: 'C2',
      name: 'C2',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      visible: true,
      constraints: { horizontal: 'MIN', vertical: 'MIN' },
      absoluteBoundingBox: { x: 10, y: 10, width: 100, height: 100 },
      children: [],
    };
    const nodeB = {
      type: 'GROUP',
      id: 'B2',
      name: 'B2',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      visible: true,
      constraints: { horizontal: 'MIN', vertical: 'MIN' },
      absoluteBoundingBox: { x: 10, y: 10, width: 100, height: 100 },
      children: [nodeC],
    };
    (nodeC as unknown as { parent: unknown }).parent = nodeB;
    const nodeA = {
      type: 'GROUP',
      id: 'A2',
      name: 'A2',
      x: 10,
      y: 10,
      width: 100,
      height: 100,
      visible: true,
      exportSettings: [{ format: 'PNG' }],
      absoluteBoundingBox: { x: 10, y: 10, width: 100, height: 100 },
      absoluteTransform: [[1, 0, 10], [0, 1, 10]],
      children: [nodeB],
    } as unknown as SceneNode;
    (nodeB as unknown as { parent: unknown }).parent = nodeA;
    const frame = mockFrame({ children: [nodeA] });
    (nodeA as unknown as { parent: unknown }).parent = frame;

    const report = new ReportCollector();
    const roles = annotateExportTree(frame);
    const irFrame = buildFrameIr(frame, roles, report);
    const aNode = irFrame.children[0];
    expect(aNode?.kind).toBe('container');
    if (!aNode || aNode.kind !== 'container') return;
    const bNode = aNode.children.find((n) => n.id === 'B2');
    const cNode = bNode && bNode.kind === 'container' ? bNode.children.find((n) => n.id === 'C2') : undefined;

    const aExt = aNode.extensions as Record<string, unknown>;
    expect(aExt.constraints).toBeUndefined();
    expect(aExt.constraintsPromotedFromChild).toBeUndefined();
    expect((bNode?.extensions as Record<string, unknown> | undefined)?.constraints).toBeUndefined();
    expect((cNode?.extensions as Record<string, unknown> | undefined)?.constraints).toBeUndefined();
  });
});
