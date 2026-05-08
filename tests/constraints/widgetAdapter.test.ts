import { describe, expect, it } from 'vitest';
import type { ConstraintSpec } from '../../src/domain/constraints/model';
import { buildWidgetNumericSnapshot } from '../../src/domain/constraints/model';
import { analyzeCocos3Fit } from '../../src/domain/constraints/capability';
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
  };
}

describe('widget adapter', () => {
  it('maps stretch to left/right align flags', () => {
    const s = spec('stretch', 'min');
    const cfg = toWidgetConfig(s, analyzeCocos3Fit(s));
    expect(cfg.isAlignLeft).toBe(true);
    expect(cfg.isAlignRight).toBe(true);
    expect(cfg.left).toBe(100);
    expect(cfg.right).toBe(700);
  });

  it('maps center to center fields', () => {
    const cfg = toWidgetConfig(spec('center', 'center'), analyzeCocos3Fit(spec('center', 'center')));
    expect(cfg.isAlignHorizontalCenter).toBe(true);
    expect(cfg.isAlignVerticalCenter).toBe(true);
    expect(cfg.horizontalCenter).toBe(-300);
    expect(cfg.verticalCenter).toBe(240);
  });

  it('returns disabled config for unsupported fit', () => {
    const unsupported = { ...spec('min', 'min'), transform: { rotated: true } };
    const cfg = toWidgetConfig(unsupported, analyzeCocos3Fit(unsupported));
    expect(cfg.isAlignLeft).toBe(false);
    expect(cfg.isAlignRight).toBe(false);
    expect(cfg.isAlignTop).toBe(false);
  });

  it('uses center approximation for scale mode', () => {
    const s = spec('scale', 'scale');
    const cfg = toWidgetConfig(s, analyzeCocos3Fit(s));
    expect(cfg.isAlignHorizontalCenter).toBe(true);
    expect(cfg.isAlignVerticalCenter).toBe(true);
    expect(cfg.isAlignLeft).toBe(false);
    expect(cfg.isAlignRight).toBe(false);
    expect(cfg.isAlignTop).toBe(false);
    expect(cfg.isAlignBottom).toBe(false);
  });
});
