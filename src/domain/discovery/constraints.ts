/**
 * Figma constraints → `ConstraintSpec`（路线 A 入口）：仅 FRAME；在此阶段写入 `widgetNumbers` 供后续 Adapter。
 * 映射表见 `docs/superpowers/specs/2026-04-16-figma-constraints-widget-mapping-design.md` §3。
 */
import type { ConstraintAxis, ConstraintSpec } from '../constraints/model';
import { buildWidgetNumericSnapshot } from '../constraints/model';

type FigmaConstraintAxis =
  | 'MIN'
  | 'MAX'
  | 'CENTER'
  | 'STRETCH'
  | 'SCALE'
  // Backward-compatible aliases for older/legacy fixtures.
  | 'LEFT'
  | 'RIGHT'
  | 'LEFT_RIGHT'
  | 'TOP'
  | 'BOTTOM'
  | 'TOP_BOTTOM';

function mapAxis(mode: FigmaConstraintAxis): ConstraintAxis {
  if (mode === 'CENTER') return 'center';
  if (mode === 'SCALE') return 'scale';
  if (mode === 'STRETCH' || mode === 'LEFT_RIGHT' || mode === 'TOP_BOTTOM') return 'stretch';
  if (mode === 'MIN' || mode === 'LEFT' || mode === 'TOP') return 'min';
  if (mode === 'MAX' || mode === 'RIGHT' || mode === 'BOTTOM') return 'max';
  return 'min';
}

export function extractConstraintSpec(
  node: SceneNode,
  parentSize: { width: number; height: number },
  placement: { x: number; y: number; width: number; height: number },
): ConstraintSpec | undefined {
  if (node.type !== 'FRAME') {
    return undefined;
  }
  if (!('constraints' in node) || !node.constraints) {
    return undefined;
  }

  const constraints = node.constraints as { horizontal: FigmaConstraintAxis; vertical: FigmaConstraintAxis };

  return {
    horizontal: mapAxis(constraints.horizontal),
    vertical: mapAxis(constraints.vertical),
    base: {
      horizontal: {
        parent: parentSize.width,
        pos: placement.x,
        size: placement.width,
      },
      vertical: {
        parent: parentSize.height,
        pos: placement.y,
        size: placement.height,
      },
    },
    widgetNumbers: buildWidgetNumericSnapshot(parentSize, placement),
    policy: {
      structureFirst: true,
      rounding: 'half-pixel',
    },
  };
}
