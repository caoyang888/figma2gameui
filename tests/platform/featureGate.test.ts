import { describe, it, expect } from 'vitest';
import { ConfigFeatureGate, AllEnabledFeatureGate } from '../../src/platform/featureGate';

describe('ConfigFeatureGate', () => {
  it('returns true for enabled features', () => {
    const gate = new ConfigFeatureGate({ scriptBinding: true });
    expect(gate.isEnabled('scriptBinding')).toBe(true);
  });

  it('returns false for disabled features', () => {
    const gate = new ConfigFeatureGate({ scriptBinding: false });
    expect(gate.isEnabled('scriptBinding')).toBe(false);
  });

  it('returns false for unknown features', () => {
    const gate = new ConfigFeatureGate({});
    expect(gate.isEnabled('unknown')).toBe(false);
  });
});

describe('AllEnabledFeatureGate', () => {
  it('always returns true', () => {
    const gate = new AllEnabledFeatureGate();
    expect(gate.isEnabled('anything')).toBe(true);
  });
});
