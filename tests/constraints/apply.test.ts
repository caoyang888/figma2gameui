import { describe, expect, it } from 'vitest';
import { applyConstraintFitMetadata } from '../../src/domain/constraints/apply';
import { ReportCollector } from '../../src/pipeline/report';
import { IR_VERSION, type IR } from '../../src/domain/ir/schema';
import { buildWidgetNumericSnapshot } from '../../src/domain/constraints/model';

function makeIr(): IR {
  return {
    version: IR_VERSION,
    generatedAt: '2026-04-16T00:00:00Z',
    sourceFileKey: 'k',
    frames: [
      {
        id: 'f1',
        name: 'F1',
        width: 100,
        height: 100,
        assets: [],
        children: [
          {
            kind: 'container',
            id: 'n1',
            name: 'N1',
            placement: { x: 10, y: 10, width: 20, height: 20 },
            opacity: 1,
            visible: true,
            extensions: {
              constraints: {
                horizontal: 'stretch',
                vertical: 'center',
                base: {
                  horizontal: { parent: 100, pos: 10, size: 20 },
                  vertical: { parent: 100, pos: 10, size: 20 },
                },
                widgetNumbers: buildWidgetNumericSnapshot(
                  { width: 100, height: 100 },
                  { x: 10, y: 10, width: 20, height: 20 },
                ),
              },
            },
            children: [],
          },
          {
            kind: 'container',
            id: 'n2',
            name: 'N2',
            placement: { x: 0, y: 0, width: 20, height: 20 },
            opacity: 1,
            visible: true,
            extensions: {
              constraints: {
                horizontal: 'min',
                vertical: 'min',
                transform: { rotated: true },
                base: {
                  horizontal: { parent: 100, pos: 0, size: 20 },
                  vertical: { parent: 100, pos: 0, size: 20 },
                },
                widgetNumbers: buildWidgetNumericSnapshot(
                  { width: 100, height: 100 },
                  { x: 0, y: 0, width: 20, height: 20 },
                ),
              },
            },
            children: [],
          },
        ],
      },
    ],
  };
}

describe('applyConstraintFitMetadata', () => {
  it('annotates node fit metadata and writes warnings/errors', () => {
    const ir = makeIr();
    const report = new ReportCollector();
    applyConstraintFitMetadata(ir, report);

    const n1 = ir.frames[0]!.children[0]!;
    const n2 = ir.frames[0]!.children[1]!;

    expect(n1.fitQuality).toBe('approx');
    expect(n1.reasonCode).toBe('CENTER_STRETCH_CONFLICT');
    expect(n1.errorMetrics).toBeUndefined();
    expect(n2.fitQuality).toBe('unsupported');
    expect(n2.reasonCode).toBe('NON_AXIS_ALIGNED');

    const entries = report.getEntries();
    expect(entries.some((e) => e.level === 'warning' && e.nodeId === 'n1')).toBe(true);
    expect(entries.some((e) => e.level === 'error' && e.nodeId === 'n2')).toBe(true);
    const dbg1 = (n1.extensions as Record<string, unknown>).constraintsDebug as Record<string, unknown>;
    expect(dbg1.sourceNodeId).toBe('n1');
    expect(dbg1.constraintsAttachedAtThisNode).toBe(true);
  });

  it('creates widget for every node that has constraints spec', () => {
    const ir: IR = {
      version: IR_VERSION,
      generatedAt: '2026-04-16T00:00:00Z',
      sourceFileKey: 'k',
      frames: [
        {
          id: 'f2',
          name: 'F2',
          width: 100,
          height: 100,
          assets: [],
          children: [
            {
              kind: 'container',
              id: 'parent',
              name: 'Parent',
              placement: { x: 0, y: 0, width: 100, height: 100 },
              opacity: 1,
              visible: true,
              extensions: {
                constraints: {
                  horizontal: 'stretch',
                  vertical: 'stretch',
                  base: {
                    horizontal: { parent: 100, pos: 0, size: 100 },
                    vertical: { parent: 100, pos: 0, size: 100 },
                  },
                  widgetNumbers: buildWidgetNumericSnapshot(
                    { width: 100, height: 100 },
                    { x: 0, y: 0, width: 100, height: 100 },
                  ),
                },
              },
              children: [
                {
                  kind: 'container',
                  id: 'child',
                  name: 'Child',
                  placement: { x: 10, y: 10, width: 20, height: 20 },
                  opacity: 1,
                  visible: true,
                  extensions: {
                    constraints: {
                      horizontal: 'min',
                      vertical: 'min',
                      base: {
                        horizontal: { parent: 100, pos: 10, size: 20 },
                        vertical: { parent: 100, pos: 10, size: 20 },
                      },
                      widgetNumbers: buildWidgetNumericSnapshot(
                        { width: 100, height: 100 },
                        { x: 10, y: 10, width: 20, height: 20 },
                      ),
                    },
                  },
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    };

    const report = new ReportCollector();
    applyConstraintFitMetadata(ir, report);
    const parent = ir.frames[0]!.children[0]!;
    const child = (parent.kind === 'container' ? parent.children[0] : undefined)!;

    expect((parent.extensions as Record<string, unknown>).widget).toBeDefined();
    expect(parent.fitQuality).toBeDefined();
    expect((child.extensions as Record<string, unknown>).widget).toBeDefined();
    expect(child.fitQuality).toBeDefined();
    expect(child.reasonCode).toBeDefined();
    const parentDbg = (parent.extensions as Record<string, unknown>).constraintsDebug as Record<string, unknown>;
    const childDbg = (child.extensions as Record<string, unknown>).constraintsDebug as Record<string, unknown>;
    expect(parentDbg.constraintsAttachedAtThisNode).toBe(true);
    expect(childDbg.skippedByAncestorConstraints).toBe(false);
  });
});
