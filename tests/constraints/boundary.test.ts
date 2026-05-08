import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConstraintSpec, Size } from '../../src/domain/constraints/model';
import { solveRect } from '../../src/domain/constraints/solver';
import { analyzeCocos3Fit } from '../../src/domain/constraints/capability';
import { evaluateFit } from '../../src/domain/constraints/errorMetrics';
import { toWidgetConfig } from '../../src/domain/emitters/cocos3/widgetAdapter';

function loadFixture<T>(name: string): T {
  const p = join(__dirname, 'fixtures', name);
  return JSON.parse(readFileSync(p, 'utf8')) as T;
}

function baseSpec(): ConstraintSpec {
  return {
    horizontal: 'min',
    vertical: 'min',
    base: {
      horizontal: { parent: 1000, pos: 100, size: 200 },
      vertical: { parent: 800, pos: 80, size: 160 },
    },
    policy: { rounding: 'half-pixel', structureFirst: true },
  };
}

describe('constraints 12-boundary regression suite', () => {
  it('boundary-01 center+scale fixture keeps finite geometry', () => {
    const fx = loadFixture<{ spec: ConstraintSpec; sampleSizes: Size[] }>('boundary-center-scale.json');
    for (const size of fx.sampleSizes) {
      const rect = solveRect(fx.spec, size);
      expect(Number.isFinite(rect.x)).toBe(true);
      expect(Number.isFinite(rect.w)).toBe(true);
    }
  });

  it('boundary-02 stretch threshold transition has no sign flip', () => {
    const fx = loadFixture<{ spec: ConstraintSpec; sampleSizes: Size[] }>('boundary-stretch-threshold.json');
    const results = fx.sampleSizes.map((s) => solveRect(fx.spec, s));
    expect(Number.isFinite(results[0]!.w)).toBe(true);
    expect(results[0]!.w).toBeGreaterThan(results[1]!.w);
    expect(results[1]!.w).toBeGreaterThan(results[2]!.w);
  });

  it('boundary-03 zero child size is valid and stable', () => {
    const spec = baseSpec();
    spec.base.horizontal.size = 0;
    spec.base.vertical.size = 0;
    const rect = solveRect(spec, { w: 1200, h: 900 });
    expect(rect.w).toBe(0);
    expect(rect.h).toBe(0);
  });

  it('boundary-04 zero margin pins to edges correctly', () => {
    const spec = baseSpec();
    spec.horizontal = 'stretch';
    spec.vertical = 'stretch';
    spec.base.horizontal.pos = 0;
    spec.base.vertical.pos = 0;
    spec.base.horizontal.size = 1000;
    spec.base.vertical.size = 800;
    const rect = solveRect(spec, { w: 1500, h: 1000 });
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    expect(rect.w).toBe(1500);
    expect(rect.h).toBe(1000);
  });

  it('boundary-05 threshold equality returns deterministic metric', () => {
    const spec = baseSpec();
    spec.horizontal = 'scale';
    const fit = analyzeCocos3Fit(spec);
    const cfg = toWidgetConfig(spec, fit);
    const metrics = evaluateFit(spec, cfg, [{ w: 1500, h: 800 }]);
    expect(metrics.maxPosErrorPx).toBeGreaterThanOrEqual(0);
    expect(metrics.maxSizeErrorPx).toBeGreaterThanOrEqual(0);
  });

  it('boundary-06 half-pixel rounding follows .5 rule', () => {
    const spec = baseSpec();
    spec.base.horizontal.pos = 100.25;
    const rect = solveRect(spec, { w: 1000, h: 800 });
    expect(rect.x).toBe(100.5);
  });

  it('boundary-07 negative parent size throws', () => {
    expect(() => solveRect(baseSpec(), { w: -10, h: 100 })).toThrow(/CONSTRAINT_INVALID_PARENT_SIZE/);
  });

  it('boundary-08 NaN and Infinity throw', () => {
    const specNaN = baseSpec();
    specNaN.base.horizontal.parent = Number.NaN;
    expect(() => solveRect(specNaN, { w: 100, h: 100 })).toThrow(/CONSTRAINT_INVALID_NUMBER/);
    const specInf = baseSpec();
    specInf.base.vertical.size = Number.POSITIVE_INFINITY;
    expect(() => solveRect(specInf, { w: 100, h: 100 })).toThrow(/CONSTRAINT_INVALID_NUMBER/);
  });

  it('boundary-09 deep nesting remains stable through repeated solve', () => {
    const spec = baseSpec();
    let parent = { w: 1000, h: 800 };
    for (let i = 0; i < 9; i++) {
      const rect = solveRect(spec, parent);
      parent = { w: Math.max(1, Math.round(rect.w)), h: Math.max(1, Math.round(rect.h)) };
    }
    expect(parent.w).toBeGreaterThan(0);
    expect(parent.h).toBeGreaterThan(0);
  });

  it('boundary-10 rotated node is unsupported (fixture)', () => {
    const fx = loadFixture<{ spec: ConstraintSpec }>('boundary-rotated-unsupported.json');
    const fit = analyzeCocos3Fit(fx.spec);
    expect(fit.quality).toBe('unsupported');
    expect(fit.reasonCode).toBe('NON_AXIS_ALIGNED');
  });

  it('boundary-11 repeated analysis is deterministic', () => {
    const spec = baseSpec();
    spec.horizontal = 'center';
    spec.vertical = 'stretch';
    const a = analyzeCocos3Fit(spec);
    const b = analyzeCocos3Fit(spec);
    expect(a).toEqual(b);
  });

  it('boundary-12 historical regression: center+stretch stays approx', () => {
    const spec = baseSpec();
    spec.horizontal = 'center';
    spec.vertical = 'stretch';
    const fit = analyzeCocos3Fit(spec);
    expect(fit.quality).toBe('approx');
    expect(fit.reasonCode).toBe('CENTER_STRETCH_CONFLICT');
  });
});
