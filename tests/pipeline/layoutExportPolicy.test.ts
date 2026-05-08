import { describe, it, expect } from 'vitest';
import { IR_VERSION, type IR } from '../../src/domain/ir/schema';
import {
  stripConstraintsFromIr,
  stripFigmaAutoLayoutFromIr,
} from '../../src/pipeline/layoutExportPolicy';

function minimalIr(): IR {
  return {
    version: IR_VERSION,
    generatedAt: '',
    sourceFileKey: '',
    frames: [
      {
        id: 'f1',
        name: 'F',
        width: 100,
        height: 100,
        assets: [],
        children: [
          {
            kind: 'container',
            id: 'c1',
            name: 'C',
            placement: { x: 0, y: 0, width: 10, height: 10 },
            opacity: 1,
            visible: true,
            layout: { type: 'flex', direction: 'row', gap: 0, padding: { left: 0, right: 0, top: 0, bottom: 0 } },
            fitQuality: 'exact',
            reasonCode: 'ok',
            extensions: {
              constraints: { base: 'TL', horizontal: 'min', vertical: 'min' } as unknown,
              widget: { isAlignLeft: true } as unknown,
              constraintsDebug: { hasConstraintSpec: true } as unknown,
              other: 1,
            },
            children: [],
          },
        ],
      },
    ],
  };
}

describe('layoutExportPolicy', () => {
  it('stripConstraintsFromIr removes constraint-related fields and keeps other extensions', () => {
    const ir = minimalIr();
    stripConstraintsFromIr(ir);
    const n = ir.frames[0].children[0];
    if (n.kind !== 'container') throw new Error('expected container');
    expect(n.extensions.constraints).toBeUndefined();
    expect(n.extensions.widget).toBeUndefined();
    expect(n.extensions.constraintsDebug).toBeUndefined();
    expect(n.extensions.other).toBe(1);
    expect(n.fitQuality).toBeUndefined();
    expect(n.reasonCode).toBeUndefined();
    expect(n.layout).toEqual({
      type: 'flex',
      direction: 'row',
      gap: 0,
      padding: { left: 0, right: 0, top: 0, bottom: 0 },
    });
  });

  it('stripFigmaAutoLayoutFromIr removes layout only', () => {
    const ir = minimalIr();
    stripFigmaAutoLayoutFromIr(ir);
    const n = ir.frames[0].children[0];
    if (n.kind !== 'container') throw new Error('expected container');
    expect(n.layout).toBeUndefined();
    expect((n.extensions as { constraints?: unknown }).constraints).toBeDefined();
  });
});
