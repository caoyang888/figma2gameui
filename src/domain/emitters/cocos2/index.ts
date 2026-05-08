import type { Emitter, EmitInput, EmitOutput, EmitterDescriptor } from '../types';
import { generateCocos2Files, type Cocos2EmitterSettings } from './prefab';

export class CocosCreator2Emitter implements Emitter {
  readonly descriptor: EmitterDescriptor = {
    id: 'cocos-creator-2',
    name: 'Cocos Creator 2.4.x',
    engineVersions: ['2.4.x'],
    capabilities: ['sprite', 'text', 'layout'],
  };

  emit(input: EmitInput): EmitOutput {
    const settings = {
      ...(input.settings as Cocos2EmitterSettings),
      engineVersion: input.engineVersion,
    } satisfies Cocos2EmitterSettings;
    const result = generateCocos2Files(input.ir, settings);
    return { files: result.files, warnings: result.warnings };
  }
}

