import type { IR } from '../ir/schema';
import type { OutputFile, ReportEntry } from '../../shared/types';

export type EmitterCapability =
  | 'sprite'
  | 'text'
  | 'slicedSprite'
  | 'mask'
  | 'layout'
  | 'scriptBinding'
  | 'l10n';

export type EmitterDescriptor = {
  id: string;
  name: string;
  engineVersions: string[];
  capabilities: EmitterCapability[];
};

export type EmitInput = {
  ir: IR;
  settings: Record<string, unknown>;
  engineVersion: string;
};

export type EmitOutput = {
  files: OutputFile[];
  warnings: ReportEntry[];
};

export interface Emitter {
  readonly descriptor: EmitterDescriptor;
  emit(input: EmitInput): EmitOutput;
}
