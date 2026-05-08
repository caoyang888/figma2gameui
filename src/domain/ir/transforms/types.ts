import type { IR } from '../schema';

export type TransformContext = {
  settings: Record<string, unknown>;
  report: { add(level: 'error' | 'warning' | 'info', message: string, nodeId?: string): void };
  engineId: string;
};

export interface IrTransform {
  readonly id: string;
  readonly name: string;
  readonly phase: 'builtin' | 'optional';
  readonly featureKey?: string;
  transform(ir: IR, ctx: TransformContext): IR;
}
