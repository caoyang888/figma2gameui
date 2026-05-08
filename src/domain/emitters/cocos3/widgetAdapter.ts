/**
 * 路线 A：`ConstraintSpec` 的轴模式 + `widgetNumbers`（或从 base 生成的快照）→ `cc.Widget` 对齐开关与边距。
 * 不根据「父节点当前尺寸变化」重算几何；父尺寸变化由引擎 Widget 运行时行为 + 快照初值共同决定。
 */
import type { ConstraintSpec, FitResult } from '../../constraints/model';
import { buildWidgetNumericSnapshot } from '../../constraints/model';

export type WidgetConfig = {
  isAlignLeft: boolean;
  isAlignRight: boolean;
  isAlignTop: boolean;
  isAlignBottom: boolean;
  isAlignHorizontalCenter: boolean;
  isAlignVerticalCenter: boolean;
  left: number;
  right: number;
  top: number;
  bottom: number;
  horizontalCenter: number;
  verticalCenter: number;
};

function makeDefaultConfig(): WidgetConfig {
  return {
    isAlignLeft: false,
    isAlignRight: false,
    isAlignTop: false,
    isAlignBottom: false,
    isAlignHorizontalCenter: false,
    isAlignVerticalCenter: false,
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    horizontalCenter: 0,
    verticalCenter: 0,
  };
}

/** 与 IR 提取阶段一致：优先用 widgetNumbers，否则从 base 拼出 placement 再快照（兼容手写 spec）。 */
function snapshotForWidget(spec: ConstraintSpec) {
  if (spec.widgetNumbers) {
    return spec.widgetNumbers;
  }
  const hb = spec.base.horizontal;
  const vb = spec.base.vertical;
  return buildWidgetNumericSnapshot(
    { width: hb.parent, height: vb.parent },
    { x: hb.pos, y: vb.pos, width: hb.size, height: vb.size },
  );
}

function mapAxisHorizontal(spec: ConstraintSpec, out: WidgetConfig, snap: ReturnType<typeof snapshotForWidget>): void {
  switch (spec.horizontal) {
    case 'min':
      out.isAlignLeft = true;
      out.left = snap.left;
      break;
    case 'max':
      out.isAlignRight = true;
      out.right = snap.right;
      break;
    case 'center':
      out.isAlignHorizontalCenter = true;
      out.horizontalCenter = snap.horizontalCenter;
      break;
    case 'stretch':
      out.isAlignLeft = true;
      out.isAlignRight = true;
      out.left = snap.left;
      out.right = snap.right;
      break;
    case 'scale':
      out.isAlignHorizontalCenter = true;
      out.horizontalCenter = snap.horizontalCenter;
      break;
  }
}

function mapAxisVertical(spec: ConstraintSpec, out: WidgetConfig, snap: ReturnType<typeof snapshotForWidget>): void {
  switch (spec.vertical) {
    case 'min':
      out.isAlignTop = true;
      out.top = snap.top;
      break;
    case 'max':
      out.isAlignBottom = true;
      out.bottom = snap.bottom;
      break;
    case 'center':
      out.isAlignVerticalCenter = true;
      out.verticalCenter = snap.verticalCenter;
      break;
    case 'stretch':
      out.isAlignTop = true;
      out.isAlignBottom = true;
      out.top = snap.top;
      out.bottom = snap.bottom;
      break;
    case 'scale':
      out.isAlignVerticalCenter = true;
      out.verticalCenter = snap.verticalCenter;
      break;
  }
}

export function toWidgetConfig(spec: ConstraintSpec, fit: FitResult): WidgetConfig {
  const cfg = makeDefaultConfig();
  if (fit.quality === 'unsupported') {
    return cfg;
  }
  const snap = snapshotForWidget(spec);
  mapAxisHorizontal(spec, cfg, snap);
  mapAxisVertical(spec, cfg, snap);
  return cfg;
}

/** 预制体根节点铺满父级（四边对齐，边距均为 0），用于全屏 UI Canvas 下撑满视口。 */
export function fullScreenRootWidgetConfig(): WidgetConfig {
  return {
    isAlignLeft: true,
    isAlignRight: true,
    isAlignTop: true,
    isAlignBottom: true,
    isAlignHorizontalCenter: false,
    isAlignVerticalCenter: false,
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    horizontalCenter: 0,
    verticalCenter: 0,
  };
}
