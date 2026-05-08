/**
 * 父尺寸 → 子矩形几何真值（与 Figma 约束语义对齐）。用于验证 / errorMetrics / 单测，非导出写 Widget 主路径。
 * 主路径见 `apply.ts` 与 `docs/superpowers/specs/2026-04-16-figma-constraints-widget-mapping-design.md` 路线 A。
 */
import type { AxisBase, ConstraintAxis, ConstraintSpec, Rect, Size } from './model';

function assertFiniteNumber(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`CONSTRAINT_INVALID_NUMBER:${field}`);
  }
}

function validateAxisBase(base: AxisBase, axis: 'x' | 'y'): void {
  assertFiniteNumber(base.parent, `${axis}.parent`);
  assertFiniteNumber(base.pos, `${axis}.pos`);
  assertFiniteNumber(base.size, `${axis}.size`);
  if (base.parent <= 0) {
    throw new Error(`CONSTRAINT_INVALID_PARENT:${axis}`);
  }
  if (base.size < 0) {
    throw new Error(`CONSTRAINT_INVALID_SIZE:${axis}`);
  }
}

type AxisSolved = { pos: number; size: number };

function solveAxis(mode: ConstraintAxis, base: AxisBase, parentNow: number): AxisSolved {
  assertFiniteNumber(parentNow, 'parentNow');
  if (parentNow <= 0) throw new Error('CONSTRAINT_INVALID_PARENT_NOW');

  const left = base.pos;
  const width = base.size;
  const right = base.parent - base.pos - base.size;
  const center = base.pos + base.size / 2 - base.parent / 2;

  switch (mode) {
    case 'min':
      return { pos: left, size: width };
    case 'max':
      return { pos: parentNow - right - width, size: width };
    case 'center':
      return { pos: parentNow / 2 + center - width / 2, size: width };
    case 'stretch':
      return { pos: left, size: parentNow - left - right };
    case 'scale': {
      const scale = parentNow / base.parent;
      return { pos: left * scale, size: width * scale };
    }
    default:
      throw new Error('CONSTRAINT_UNKNOWN_AXIS_MODE');
  }
}

function applyRounding(value: number, rounding: 'pixel' | 'half-pixel' | undefined): number {
  if (rounding === 'half-pixel') return Math.round(value * 2) / 2;
  return Math.round(value);
}

export function solveRect(spec: ConstraintSpec, parentNow: Size): Rect {
  validateAxisBase(spec.base.horizontal, 'x');
  validateAxisBase(spec.base.vertical, 'y');
  assertFiniteNumber(parentNow.w, 'parentNow.w');
  assertFiniteNumber(parentNow.h, 'parentNow.h');
  if (parentNow.w <= 0 || parentNow.h <= 0) {
    throw new Error('CONSTRAINT_INVALID_PARENT_SIZE');
  }

  const sx = solveAxis(spec.horizontal, spec.base.horizontal, parentNow.w);
  const sy = solveAxis(spec.vertical, spec.base.vertical, parentNow.h);
  const rounding = spec.policy?.rounding;

  return {
    x: applyRounding(sx.pos, rounding),
    y: applyRounding(sy.pos, rounding),
    w: applyRounding(sx.size, rounding),
    h: applyRounding(sy.size, rounding),
  };
}

export function buildRectFunction(spec: ConstraintSpec): (parent: Size) => Rect {
  return (parent: Size) => solveRect(spec, parent);
}
