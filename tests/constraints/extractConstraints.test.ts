import { describe, expect, it } from 'vitest';
import { extractConstraintSpec } from '../../src/domain/discovery/constraints';

describe('extractConstraintSpec', () => {
  it('maps runtime figma MIN/MAX/STRETCH values correctly', () => {
    const node = {
      type: 'FRAME',
      constraints: { horizontal: 'STRETCH', vertical: 'MAX' },
    } as unknown as SceneNode;

    const spec = extractConstraintSpec(
      node,
      { width: 1000, height: 800 },
      { x: 100, y: 80, width: 200, height: 160 },
    );

    expect(spec).toBeDefined();
    expect(spec!.horizontal).toBe('stretch');
    expect(spec!.vertical).toBe('max');
    expect(spec!.widgetNumbers).toEqual({
      left: 100,
      top: 80,
      right: 700,
      bottom: 560,
      horizontalCenter: -300,
      verticalCenter: 240,
    });
  });

  it('keeps backward compatibility for LEFT_RIGHT aliases', () => {
    const node = {
      type: 'FRAME',
      constraints: { horizontal: 'LEFT_RIGHT', vertical: 'TOP_BOTTOM' },
    } as unknown as SceneNode;

    const spec = extractConstraintSpec(
      node,
      { width: 1000, height: 800 },
      { x: 100, y: 80, width: 200, height: 160 },
    );

    expect(spec).toBeDefined();
    expect(spec!.horizontal).toBe('stretch');
    expect(spec!.vertical).toBe('stretch');
    expect(spec!.widgetNumbers).toEqual({
      left: 100,
      top: 80,
      right: 700,
      bottom: 560,
      horizontalCenter: -300,
      verticalCenter: 240,
    });
  });
});
