export type ConstraintAxis = 'min' | 'max' | 'center' | 'stretch' | 'scale';

export type Size = {
  w: number;
  h: number;
};

export type Rect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type AxisBase = {
  parent: number;
  pos: number;
  size: number;
};

/** cc.Widget 用的边距/中心偏移，由 layout 数值一次性生成，避免在 adapter 里重复推导。 */
export type WidgetNumericSnapshot = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  horizontalCenter: number;
  verticalCenter: number;
};

export function buildWidgetNumericSnapshot(
  parent: { width: number; height: number },
  placement: { x: number; y: number; width: number; height: number },
): WidgetNumericSnapshot {
  const x = placement.x;
  const y = placement.y;
  const w = placement.width;
  const h = placement.height;
  const pw = parent.width;
  const ph = parent.height;
  return {
    left: x,
    top: y,
    right: pw - x - w,
    bottom: ph - y - h,
    horizontalCenter: x + w / 2 - pw / 2,
    /** Cocos Widget 竖直中心为 y 轴向上，相对 Figma 自上而下做一次符号约定。 */
    verticalCenter: -(y + h / 2 - ph / 2),
  };
}

export type ConstraintSpec = {
  horizontal: ConstraintAxis;
  vertical: ConstraintAxis;
  base: {
    horizontal: AxisBase;
    vertical: AxisBase;
  };
  /** 与 IR placement + 父尺寸对齐的 Widget 数值快照；adapter 只读此字段，不再从 base 重算。 */
  widgetNumbers?: WidgetNumericSnapshot;
  transform?: {
    rotated?: boolean;
    mirrored?: boolean;
  };
  policy?: {
    structureFirst?: boolean;
    rounding?: 'pixel' | 'half-pixel';
  };
};

export type FitQuality = 'exact' | 'approx' | 'unsupported';

export type ErrorMetrics = {
  maxPosErrorPx: number;
  maxSizeErrorPx: number;
};

export type FitResult = {
  quality: FitQuality;
  reasonCode: string;
  metrics?: ErrorMetrics;
};
