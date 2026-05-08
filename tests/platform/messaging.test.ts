import { describe, it, expect, vi } from 'vitest';
import { MessageRouter } from '../../src/platform/messaging';

describe('MessageRouter', () => {
  it('dispatches to registered handler', async () => {
    const router = new MessageRouter();
    const fn = vi.fn();
    router.on('TEST', fn);
    await router.dispatch({ type: 'TEST', data: 42 });
    expect(fn).toHaveBeenCalledWith({ type: 'TEST', data: 42 });
  });

  it('ignores unknown message types', async () => {
    const router = new MessageRouter();
    await router.dispatch({ type: 'UNKNOWN' });
  });

  it('ignores non-object messages', async () => {
    const router = new MessageRouter();
    await router.dispatch(null);
    await router.dispatch('string');
    await router.dispatch(42);
  });

  it('handles async handlers', async () => {
    const router = new MessageRouter();
    let resolved = false;
    router.on('ASYNC', async () => {
      await new Promise((r) => setTimeout(r, 10));
      resolved = true;
    });
    await router.dispatch({ type: 'ASYNC' });
    expect(resolved).toBe(true);
  });
});
