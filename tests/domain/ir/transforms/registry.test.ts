import { describe, it, expect } from 'vitest';
import { TransformRegistry, type FeatureGate } from '../../../../src/domain/ir/transforms/registry';
import type { TransformContext } from '../../../../src/domain/ir/transforms/types';
import { IR_VERSION, type IR } from '../../../../src/domain/ir/schema';

function makeIr(): IR {
  return {
    version: IR_VERSION,
    generatedAt: '',
    sourceFileKey: '',
    frames: [{ id: 'f1', name: 'F', width: 100, height: 100, children: [], assets: [] }],
  };
}

function makeCtx(): TransformContext {
  return { settings: {}, report: { add() {} }, engineId: 'test' };
}

const allEnabled: FeatureGate = { isEnabled: () => true };
const allDisabled: FeatureGate = { isEnabled: () => false };

describe('TransformRegistry', () => {
  it('builtin transforms always execute', () => {
    const reg = new TransformRegistry();
    const called: string[] = [];
    reg.register({
      id: 'b1', name: 'B1', phase: 'builtin',
      transform(ir) { called.push('b1'); return ir; },
    });
    reg.execute(makeIr(), makeCtx(), allDisabled);
    expect(called).toEqual(['b1']);
  });

  it('optional transforms skipped when feature disabled', () => {
    const reg = new TransformRegistry();
    const called: string[] = [];
    reg.register({
      id: 'o1', name: 'O1', phase: 'optional', featureKey: 'myFeature',
      transform(ir) { called.push('o1'); return ir; },
    });
    reg.execute(makeIr(), makeCtx(), allDisabled);
    expect(called).toEqual([]);
  });

  it('optional transforms run when feature enabled', () => {
    const reg = new TransformRegistry();
    const called: string[] = [];
    reg.register({
      id: 'o1', name: 'O1', phase: 'optional', featureKey: 'myFeature',
      transform(ir) { called.push('o1'); return ir; },
    });
    reg.execute(makeIr(), makeCtx(), allEnabled);
    expect(called).toEqual(['o1']);
  });

  it('executes in registration order', () => {
    const reg = new TransformRegistry();
    const order: string[] = [];
    reg.register({ id: 'a', name: 'A', phase: 'builtin', transform(ir) { order.push('a'); return ir; } });
    reg.register({ id: 'b', name: 'B', phase: 'builtin', transform(ir) { order.push('b'); return ir; } });
    reg.execute(makeIr(), makeCtx(), allEnabled);
    expect(order).toEqual(['a', 'b']);
  });
});
