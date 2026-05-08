import { describe, expect, it } from 'vitest';
import type { ConstraintSpec } from '../../src/domain/constraints/model';
import { analyzeCocos3Fit } from '../../src/domain/constraints/capability';

function spec(horizontal: ConstraintSpec['horizontal'], vertical: ConstraintSpec['vertical']): ConstraintSpec {
  return {
    horizontal,
    vertical,
    base: {
      horizontal: { parent: 1000, pos: 100, size: 200 },
      vertical: { parent: 800, pos: 80, size: 160 },
    },
  };
}

describe('cocos3 capability analyzer', () => {
  it('returns unsupported for rotated nodes', () => {
    const fit = analyzeCocos3Fit({ ...spec('min', 'min'), transform: { rotated: true } });
    expect(fit.quality).toBe('unsupported');
    expect(fit.reasonCode).toBe('NON_AXIS_ALIGNED');
  });

  it('returns approx for center/stretch conflict', () => {
    const fit = analyzeCocos3Fit(spec('center', 'stretch'));
    expect(fit.quality).toBe('approx');
    expect(fit.reasonCode).toBe('CENTER_STRETCH_CONFLICT');
  });

  it('returns approx for scale mode', () => {
    const fit = analyzeCocos3Fit(spec('scale', 'max'));
    expect(fit.quality).toBe('approx');
    expect(fit.reasonCode).toBe('SCALE_APPROX_WIDGET');
  });

  it('returns exact for direct mapping', () => {
    const fit = analyzeCocos3Fit(spec('min', 'max'));
    expect(fit.quality).toBe('exact');
    expect(fit.reasonCode).toBe('DIRECT_WIDGET_MAPPING');
  });

  it('is stable across repeated runs', () => {
    const input = spec('center', 'stretch');
    const a = analyzeCocos3Fit(input);
    const b = analyzeCocos3Fit(input);
    expect(a).toEqual(b);
  });
});
