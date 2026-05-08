import type { FeatureGate } from '../domain/ir/transforms/registry';

export class ConfigFeatureGate implements FeatureGate {
  constructor(private readonly features: Record<string, boolean>) {}

  isEnabled(key: string): boolean {
    return this.features[key] ?? false;
  }
}

export class AllEnabledFeatureGate implements FeatureGate {
  isEnabled(_key: string): boolean {
    return true;
  }
}
