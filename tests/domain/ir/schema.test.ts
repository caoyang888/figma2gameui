import { describe, it, expect } from 'vitest';
import { IR_VERSION, type IR, type IrContainer, type IrSprite } from '../../../src/domain/ir/schema';

describe('IR Schema v2', () => {
  it('version string', () => {
    expect(IR_VERSION).toBe('figma-ui-ir/2');
  });

  it('can construct a minimal IR document', () => {
    const ir: IR = {
      version: IR_VERSION,
      generatedAt: '2026-04-16T00:00:00Z',
      sourceFileKey: 'test-key',
      frames: [{
        id: 'frame1',
        name: 'TestFrame',
        width: 1080,
        height: 720,
        children: [],
        assets: [],
      }],
    };
    expect(ir.frames).toHaveLength(1);
    expect(ir.version).toBe('figma-ui-ir/2');
  });

  it('nodes use placement instead of separate x/y/w/h', () => {
    const sprite: IrSprite = {
      kind: 'sprite',
      id: 's1',
      name: 'bg',
      placement: { x: 10, y: 20, width: 100, height: 50 },
      opacity: 1,
      visible: true,
      extensions: {},
      assetRef: 'tex_abc',
    };
    expect(sprite.placement.x).toBe(10);
  });

  it('extensions can hold arbitrary namespaced data', () => {
    const container: IrContainer = {
      kind: 'container',
      id: 'c1',
      name: 'root',
      placement: { x: 0, y: 0, width: 1080, height: 720 },
      opacity: 1,
      visible: true,
      extensions: {
        scriptBinding: { className: 'UIPanel', uuid: '12345' },
        custom: { myField: true },
      },
      children: [],
    };
    const sb = container.extensions['scriptBinding'] as { className: string };
    expect(sb.className).toBe('UIPanel');
  });

  it('supports fit metadata fields on nodes', () => {
    const sprite: IrSprite = {
      kind: 'sprite',
      id: 's-fit',
      name: 'fit-node',
      placement: { x: 1, y: 2, width: 10, height: 20 },
      opacity: 1,
      visible: true,
      fitQuality: 'approx',
      reasonCode: 'COCOS3_CENTER_STRETCH_CONFLICT',
      errorMetrics: { maxPosErrorPx: 1, maxSizeErrorPx: 2 },
      extensions: {},
      assetRef: 'tex_fit',
    };
    expect(sprite.fitQuality).toBe('approx');
    expect(sprite.reasonCode).toContain('CONFLICT');
  });
});
