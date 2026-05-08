import type { Emitter, EmitInput, EmitOutput, EmitterDescriptor } from '../types';
import { generateCocos3Files, type Cocos3EmitterSettings } from './prefab';

export class CocosCreator3Emitter implements Emitter {
  readonly descriptor: EmitterDescriptor = {
    id: 'cocos-creator-3',
    name: 'Cocos Creator 3.x',
    engineVersions: ['3.6', '3.7', '3.8'],
    capabilities: ['sprite', 'text', 'layout'],
  };

  emit(input: EmitInput): EmitOutput {
    const settings = {
      ...(input.settings as Cocos3EmitterSettings),
      engineVersion: input.engineVersion,
    } satisfies Cocos3EmitterSettings;
    const files = generateCocos3Files(input.ir, settings);
    return { files, warnings: [] };
  }
}
