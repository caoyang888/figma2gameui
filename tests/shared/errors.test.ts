import { describe, it, expect } from 'vitest';
import { PipelineError, ok, err } from '../../src/shared/errors';

describe('Result helpers', () => {
  it('ok wraps a value', () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it('err wraps an error', () => {
    const e = new PipelineError('boom');
    const r = err(e);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toBe('boom');
      expect(r.error.fatal).toBe(true);
    }
  });

  it('PipelineError non-fatal', () => {
    const e = new PipelineError('warn', false);
    expect(e.fatal).toBe(false);
  });
});
