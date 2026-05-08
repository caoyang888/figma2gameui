/** 路线 A：对「快照 + Widget 开关」表达力分类；不调用 solver。 */
import type { ConstraintSpec, FitResult } from './model';

function unsupported(reasonCode: string): FitResult {
  return { quality: 'unsupported', reasonCode };
}

function approx(reasonCode: string): FitResult {
  return { quality: 'approx', reasonCode };
}

function exact(reasonCode: string): FitResult {
  return { quality: 'exact', reasonCode };
}

export function analyzeCocos3Fit(spec: ConstraintSpec): FitResult {
  if (spec.transform?.rotated || spec.transform?.mirrored) {
    return unsupported('NON_AXIS_ALIGNED');
  }

  const horizontal = spec.horizontal;
  const vertical = spec.vertical;

  if ((horizontal === 'center' && vertical === 'stretch') || (horizontal === 'stretch' && vertical === 'center')) {
    return approx('CENTER_STRETCH_CONFLICT');
  }

  if (horizontal === 'scale' || vertical === 'scale') {
    return approx('SCALE_APPROX_WIDGET');
  }

  return exact('DIRECT_WIDGET_MAPPING');
}
