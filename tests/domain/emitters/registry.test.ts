import { describe, it, expect } from 'vitest';
import { EmitterRegistry } from '../../../src/domain/emitters/registry';
import type { Emitter, EmitInput, EmitOutput } from '../../../src/domain/emitters/types';

function makeDummyEmitter(id: string, versions: string[] = ['1.0']): Emitter {
  return {
    descriptor: {
      id,
      name: `Engine ${id}`,
      engineVersions: versions,
      capabilities: ['sprite', 'text'],
    },
    emit(_input: EmitInput): EmitOutput {
      return { files: [], warnings: [] };
    },
  };
}

describe('EmitterRegistry', () => {
  it('register and get', () => {
    const reg = new EmitterRegistry();
    const e = makeDummyEmitter('test-engine');
    reg.register(e);
    expect(reg.get('test-engine')).toBe(e);
    expect(reg.get('nope')).toBeUndefined();
  });

  it('list returns all descriptors', () => {
    const reg = new EmitterRegistry();
    reg.register(makeDummyEmitter('a'));
    reg.register(makeDummyEmitter('b'));
    const list = reg.list();
    expect(list).toHaveLength(2);
    expect(list.map((d) => d.id).sort()).toEqual(['a', 'b']);
  });

  it('getVersions', () => {
    const reg = new EmitterRegistry();
    reg.register(makeDummyEmitter('cc3', ['3.6', '3.8']));
    expect(reg.getVersions('cc3')).toEqual(['3.6', '3.8']);
    expect(reg.getVersions('none')).toEqual([]);
  });

  it('has checks existence', () => {
    const reg = new EmitterRegistry();
    reg.register(makeDummyEmitter('x'));
    expect(reg.has('x')).toBe(true);
    expect(reg.has('y')).toBe(false);
  });
});
