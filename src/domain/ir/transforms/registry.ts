import type { IR } from '../schema';
import type { IrTransform, TransformContext } from './types';

export interface FeatureGate {
  isEnabled(key: string): boolean;
}

export class TransformRegistry {
  private readonly transforms: IrTransform[] = [];

  register(transform: IrTransform): void {
    this.transforms.push(transform);
  }

  getAll(): readonly IrTransform[] {
    return this.transforms;
  }

  execute(ir: IR, ctx: TransformContext, featureGate: FeatureGate): IR {
    let current = ir;
    for (const t of this.transforms) {
      if (t.phase === 'optional' && t.featureKey && !featureGate.isEnabled(t.featureKey)) {
        continue;
      }
      current = t.transform(current, ctx);
    }
    return current;
  }
}
