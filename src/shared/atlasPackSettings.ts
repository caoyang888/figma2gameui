/** 图集单边上限可选值（2 的幂），与插件 Slider / 持久化一致。 */
export const ATLAS_MAX_SIDE_POT_OPTIONS = [64, 128, 256, 512, 1024, 2048, 4096] as const;

export type AtlasMaxSidePot = (typeof ATLAS_MAX_SIDE_POT_OPTIONS)[number];

export const ATLAS_MAX_SIDE_POT_DEFAULT: AtlasMaxSidePot = 2048;

export const ATLAS_LARGE_SPRITE_AREA_RATIO_MIN = 0.1;
export const ATLAS_LARGE_SPRITE_AREA_RATIO_MAX = 0.9;
export const ATLAS_LARGE_SPRITE_AREA_RATIO_DEFAULT = 0.9;

/** 将任意数字收敛到 {@link ATLAS_MAX_SIDE_POT_OPTIONS} 中最近一项。 */
export function clampAtlasMaxSideToPot(n: number): AtlasMaxSidePot {
  if (!Number.isFinite(n)) {
    return ATLAS_MAX_SIDE_POT_DEFAULT;
  }
  const fl = Math.floor(n);
  let best = ATLAS_MAX_SIDE_POT_OPTIONS[0]!;
  let bestD = Infinity;
  for (const s of ATLAS_MAX_SIDE_POT_OPTIONS) {
    const d = Math.abs(s - fl);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

export function atlasMaxSidePotOptionIndex(side: number): number {
  const s = clampAtlasMaxSideToPot(side);
  const i = ATLAS_MAX_SIDE_POT_OPTIONS.indexOf(s);
  return i < 0 ? ATLAS_MAX_SIDE_POT_OPTIONS.indexOf(ATLAS_MAX_SIDE_POT_DEFAULT) : i;
}

export function potOptionIndexToMaxSide(index: number): AtlasMaxSidePot {
  const i = Math.max(0, Math.min(ATLAS_MAX_SIDE_POT_OPTIONS.length - 1, Math.round(index)));
  return ATLAS_MAX_SIDE_POT_OPTIONS[i]!;
}

/** 大图面积阈值（相对单页 atlas 上限面积），与插件 Slider 范围一致。 */
export function clampAtlasLargeSpriteAreaRatio(n: number): number {
  if (!Number.isFinite(n)) {
    return ATLAS_LARGE_SPRITE_AREA_RATIO_DEFAULT;
  }
  const x = Math.round(n * 100) / 100;
  return Math.min(ATLAS_LARGE_SPRITE_AREA_RATIO_MAX, Math.max(ATLAS_LARGE_SPRITE_AREA_RATIO_MIN, x));
}
