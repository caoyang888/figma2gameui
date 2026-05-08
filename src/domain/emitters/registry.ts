import type { Emitter, EmitterDescriptor } from './types';

export class EmitterRegistry {
  private readonly emitters = new Map<string, Emitter>();

  register(emitter: Emitter): void {
    this.emitters.set(emitter.descriptor.id, emitter);
  }

  get(id: string): Emitter | undefined {
    return this.emitters.get(id);
  }

  list(): EmitterDescriptor[] {
    return [...this.emitters.values()].map((e) => e.descriptor);
  }

  getVersions(id: string): string[] {
    return this.emitters.get(id)?.descriptor.engineVersions ?? [];
  }

  has(id: string): boolean {
    return this.emitters.has(id);
  }
}
