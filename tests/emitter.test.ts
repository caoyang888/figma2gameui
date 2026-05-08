import { describe, expect, it } from 'vitest';
import { generateCocos3Files } from '../src/domain/emitters/cocos3/prefab';
import { IR_VERSION, type IR } from '../src/domain/ir/schema';

function minimalIr(): IR {
  return {
    version: IR_VERSION,
    generatedAt: '2026-01-01T00:00:00Z',
    sourceFileKey: 'test-file',
    frames: [
      {
        id: 'frame-1',
        name: 'Hello/World',
        width: 480,
        height: 320,
        children: [
          {
            kind: 'container',
            id: 'c1',
            name: 'Box',
            placement: { x: 0, y: 0, width: 120, height: 80 },
            opacity: 1,
            visible: true,
            extensions: {},
            children: [],
          },
        ],
        assets: [],
      },
    ],
  };
}

describe('generateCocos3Files', () => {
  it('emits prefab and meta under prefabs/ with sanitized frame name', () => {
    const files = generateCocos3Files(minimalIr(), {
      assetsRootRelative: 'figma-export/ui',
    });
    const paths = files.map((f) => f.path);
    expect(paths.some((p) => p.endsWith('prefabs/Hello_World.prefab'))).toBe(true);
    expect(paths.some((p) => p.endsWith('prefabs/Hello_World.prefab.meta'))).toBe(true);
  });

  it('emits textures and wires sprite-frame uuid when texture bytes provided', () => {
    const ir: IR = {
      version: IR_VERSION,
      generatedAt: '2026-01-01T00:00:00Z',
      sourceFileKey: 'test-file',
      frames: [
        {
          id: 'f1',
          name: 'WithImage',
          width: 100,
          height: 50,
          children: [
            {
              kind: 'container',
              id: 'c1',
              name: 'Root',
              placement: { x: 0, y: 0, width: 10, height: 10 },
              opacity: 1,
              visible: true,
              extensions: {},
              children: [
                {
                  kind: 'sprite',
                  id: 'img:export',
                  name: 'x',
                  assetRef: 'export-abc.png',
                  placement: { x: 0, y: 0, width: 4, height: 4 },
                  opacity: 1,
                  visible: true,
                  extensions: {},
                },
              ],
            },
          ],
          assets: [],
        },
      ],
    };
    const files = generateCocos3Files(ir, {
      assetsRootRelative: 'assets/ui',
      textureByAssetRef: new Map([
        [
          'export-abc.png',
          { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), width: 4, height: 4 },
        ],
      ]),
    });
    expect(files.some((f) => f.path.endsWith('textures/export-abc.png'))).toBe(true);
    expect(files.some((f) => f.path.endsWith('textures/export-abc.png.meta'))).toBe(true);
    const prefab = files.find((f) => f.path.endsWith('WithImage.prefab'));
    const text = new TextDecoder().decode(prefab!.data);
    expect(text).toContain('"__type__": "cc.Sprite"');
    expect(text).toMatch(/"_spriteFrame":\s*\{\s*"__uuid__":\s*"[0-9a-f-]{36}@f9941"/);
  });

  it('prefab bytes are UTF-8 JSON starting with Prefab array', () => {
    const files = generateCocos3Files(minimalIr(), {
      assetsRootRelative: 'out',
    });
    const prefab = files.find((f) => f.path.endsWith('.prefab') && !f.path.endsWith('.meta'));
    expect(prefab).toBeDefined();
    const text = new TextDecoder().decode(prefab!.data);
    expect(text.trimStart().startsWith('[')).toBe(true);
    expect(text).toContain('"__type__": "cc.Prefab"');
    expect(text).toContain('"__type__": "cc.Node"');
  });

  it('honors custom prefab and texture directories under export root', () => {
    const ir: IR = {
      version: IR_VERSION,
      generatedAt: '2026-01-01T00:00:00Z',
      sourceFileKey: 'test-file',
      frames: [
        {
          id: 'f1',
          name: 'CustomDirs',
          width: 100,
          height: 50,
          children: [
            {
              kind: 'container',
              id: 'c1',
              name: 'Root',
              placement: { x: 0, y: 0, width: 10, height: 10 },
              opacity: 1,
              visible: true,
              extensions: {},
              children: [
                {
                  kind: 'sprite',
                  id: 'img:export',
                  name: 'x',
                  assetRef: 'export-abc.png',
                  placement: { x: 0, y: 0, width: 4, height: 4 },
                  opacity: 1,
                  visible: true,
                  extensions: {},
                },
              ],
            },
          ],
          assets: [],
        },
      ],
    };
    const files = generateCocos3Files(ir, {
      assetsRootRelative: 'pack',
      prefabsRelativeDir: 'ui/prefabs',
      texturesRelativeDir: 'res/tex',
      textureByAssetRef: new Map([
        [
          'export-abc.png',
          { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), width: 4, height: 4 },
        ],
      ]),
    });
    expect(files.some((f) => f.path === 'pack/ui/prefabs/CustomDirs.prefab')).toBe(true);
    expect(files.some((f) => f.path === 'pack/res/tex/export-abc.png')).toBe(true);
  });

  it('emits cc.Widget component when node has widget extension config', () => {
    const ir: IR = {
      version: IR_VERSION,
      generatedAt: '2026-01-01T00:00:00Z',
      sourceFileKey: 'test-file',
      frames: [
        {
          id: 'fw',
          name: 'WithWidget',
          width: 100,
          height: 100,
          children: [
            {
              kind: 'container',
              id: 'node-w',
              name: 'NodeW',
              placement: { x: 10, y: 10, width: 20, height: 20 },
              opacity: 1,
              visible: true,
              extensions: {
                widget: {
                  isAlignLeft: true,
                  isAlignRight: false,
                  isAlignTop: true,
                  isAlignBottom: false,
                  isAlignHorizontalCenter: false,
                  isAlignVerticalCenter: false,
                  left: 10,
                  right: 0,
                  top: 10,
                  bottom: 0,
                  horizontalCenter: 0,
                  verticalCenter: 0,
                },
              },
              children: [],
            },
          ],
          assets: [],
        },
      ],
    };
    const files = generateCocos3Files(ir, { assetsRootRelative: 'out' });
    const prefab = files.find((f) => f.path.endsWith('WithWidget.prefab'));
    expect(prefab).toBeDefined();
    const text = new TextDecoder().decode(prefab!.data);
    expect(text).toContain('"__type__": "cc.Widget"');
    expect(text).toContain('"_alignFlags": 9');
    expect(text).toContain('"_left": 10');
    expect(text).toContain('"_top": 10');
  });

  it('adds full-screen cc.Widget on prefab root when widgetRootFillScreen is enabled', () => {
    const files = generateCocos3Files(minimalIr(), {
      assetsRootRelative: 'out',
      widgetRootFillScreen: true,
    });
    const prefab = files.find((f) => f.path.endsWith('Hello_World.prefab'));
    expect(prefab).toBeDefined();
    const text = new TextDecoder().decode(prefab!.data);
    expect(text).toContain('"__type__": "cc.Widget"');
    expect(text).toContain('"_alignFlags": 45');
    expect(text).toContain('"_left": 0');
    expect(text).toContain('"_right": 0');
    expect(text).toContain('"_top": 0');
    expect(text).toContain('"_bottom": 0');
  });
});
