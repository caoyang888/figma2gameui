import type { ConstraintSpec, ErrorMetrics, Rect, Size } from './model';
import { buildWidgetNumericSnapshot } from './model';
import { solveRect } from './solver';
import type { WidgetConfig } from '../emitters/cocos3/widgetAdapter';

function widgetSnap(spec: ConstraintSpec) {
  return (
    spec.widgetNumbers ??
    buildWidgetNumericSnapshot(
      { width: spec.base.horizontal.parent, height: spec.base.vertical.parent },
      {
        x: spec.base.horizontal.pos,
        y: spec.base.vertical.pos,
        width: spec.base.horizontal.size,
        height: spec.base.vertical.size,
      },
    )
  );
}

function rectFromWidget(spec: ConstraintSpec, cfg: WidgetConfig, parent: Size): Rect {
  const hb = spec.base.horizontal;
  const vb = spec.base.vertical;
  const snap = widgetSnap(spec);

  let x = snap.left;
  let w = hb.size;
  if (cfg.isAlignLeft && cfg.isAlignRight) {
    x = snap.left;
    w = parent.w - snap.left - snap.right;
  } else if (cfg.isAlignLeft) {
    x = snap.left;
  } else if (cfg.isAlignRight) {
    x = parent.w - snap.right - hb.size;
  } else if (cfg.isAlignHorizontalCenter) {
    x = parent.w / 2 + snap.horizontalCenter - hb.size / 2;
  }

  let y = snap.top;
  let h = vb.size;
  if (cfg.isAlignTop && cfg.isAlignBottom) {
    y = snap.top;
    h = parent.h - snap.top - snap.bottom;
  } else if (cfg.isAlignTop) {
    y = snap.top;
  } else if (cfg.isAlignBottom) {
    y = parent.h - snap.bottom - vb.size;
  } else if (cfg.isAlignVerticalCenter) {
    y = parent.h / 2 - snap.verticalCenter - vb.size / 2;
  }

  return { x, y, w, h };
}

export function evaluateFit(spec: ConstraintSpec, widgetConfig: WidgetConfig, sampleSizes: Size[]): ErrorMetrics {
  let maxPosErrorPx = 0;
  let maxSizeErrorPx = 0;

  for (const size of sampleSizes) {
    const expected = solveRect(spec, size);
    const actual = rectFromWidget(spec, widgetConfig, size);

    const posErr = Math.max(Math.abs(expected.x - actual.x), Math.abs(expected.y - actual.y));
    const sizeErr = Math.max(Math.abs(expected.w - actual.w), Math.abs(expected.h - actual.h));
    if (posErr > maxPosErrorPx) maxPosErrorPx = posErr;
    if (sizeErr > maxSizeErrorPx) maxSizeErrorPx = sizeErr;
  }

  return { maxPosErrorPx, maxSizeErrorPx };
}
