import { describe, expect, it } from 'vitest';
import type { ConstraintSpec } from '../../src/domain/constraints/model';
import { buildWidgetNumericSnapshot } from '../../src/domain/constraints/model';
import { analyzeCocos3Fit } from '../../src/domain/constraints/capability';
import { evaluateFit } from '../../src/domain/constraints/errorMetrics';
import { toWidgetConfig } from '../../src/domain/emitters/cocos3/widgetAdapter';

function spec(horizontal: ConstraintSpec['horizontal'], vertical: ConstraintSpec['vertical']): ConstraintSpec {
  const base = {
    horizontal: { parent: 1000, pos: 100, size: 200 },
    vertical: { parent: 800, pos: 80, size: 160 },
  };
  return {
    horizontal,
    vertical,
    base,
    widgetNumbers: buildWidgetNumericSnapshot(
      { width: base.horizontal.parent, height: base.vertical.parent },
      { x: base.horizontal.pos, y: base.vertical.pos, width: base.horizontal.size, height: base.vertical.size },
    ),
    policy: { rounding: 'half-pixel' },
  };
}

describe('error metrics', () => {
  it('returns zero error for direct stretch mapping', () => {
    const s = spec('stretch', 'stretch');
    const fit = analyzeCocos3Fit(s);
    const cfg = toWidgetConfig(s, fit);
    const m = evaluateFit(s, cfg, [{ w: 320, h: 200 }, { w: 1000, h: 800 }, { w: 1440, h: 900 }]);
    expect(m.maxPosErrorPx).toBe(0);
    expect(m.maxSizeErrorPx).toBe(0);
  });

  it('reports non-zero error for scale approximation', () => {
    const s = spec('scale', 'scale');
    const fit = analyzeCocos3Fit(s);
    const cfg = toWidgetConfig(s, fit);
    const m = evaluateFit(s, cfg, [{ w: 375, h: 812 }, { w: 768, h: 1024 }, { w: 1024, h: 768 }]);
    expect(m.maxPosErrorPx).toBeGreaterThan(0);
    expect(m.maxSizeErrorPx).toBeGreaterThanOrEqual(0);
  });
});
