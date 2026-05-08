import { describe, expect, it } from 'vitest';
import type { ConstraintSpec } from '../../src/domain/constraints/model';
import { buildRectFunction, solveRect } from '../../src/domain/constraints/solver';

function makeSpec(horizontal: ConstraintSpec['horizontal'], vertical: ConstraintSpec['vertical']): ConstraintSpec {
  return {
    horizontal,
    vertical,
    base: {
      horizontal: { parent: 1000, pos: 100, size: 200 },
      vertical: { parent: 800, pos: 80, size: 160 },
    },
    policy: { rounding: 'half-pixel', structureFirst: true },
  };
}

describe('constraints solver', () => {
  it('keeps margins for stretch axis', () => {
    const rect = solveRect(makeSpec('stretch', 'min'), { w: 1200, h: 800 });
    expect(rect.x).toBe(100);
    expect(rect.w).toBe(400);
  });

  it('scales with parent for scale mode', () => {
    const rect = solveRect(makeSpec('scale', 'scale'), { w: 500, h: 400 });
    expect(rect.x).toBe(50);
    expect(rect.w).toBe(100);
    expect(rect.y).toBe(40);
    expect(rect.h).toBe(80);
  });

  it('anchors to right for max mode', () => {
    const rect = solveRect(makeSpec('max', 'max'), { w: 1200, h: 1000 });
    expect(rect.x).toBe(300);
    expect(rect.y).toBe(280);
    expect(rect.w).toBe(200);
  });

  it('returns stable function via buildRectFunction', () => {
    const fn = buildRectFunction(makeSpec('center', 'center'));
    expect(fn({ w: 1000, h: 800 })).toEqual({ x: 100, y: 80, w: 200, h: 160 });
  });

  it('throws for invalid parent size', () => {
    expect(() => solveRect(makeSpec('min', 'min'), { w: -1, h: 100 })).toThrow(/CONSTRAINT_INVALID_PARENT_SIZE/);
  });

  it('throws for NaN and Infinity', () => {
    const bad = makeSpec('min', 'min');
    bad.base.horizontal.parent = Number.NaN;
    expect(() => solveRect(bad, { w: 100, h: 100 })).toThrow(/CONSTRAINT_INVALID_NUMBER/);

    const bad2 = makeSpec('min', 'min');
    bad2.base.vertical.size = Number.POSITIVE_INFINITY;
    expect(() => solveRect(bad2, { w: 100, h: 100 })).toThrow(/CONSTRAINT_INVALID_NUMBER/);
  });
});
