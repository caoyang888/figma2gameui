import { describe, expect, it } from 'vitest';
import { CocosCreator2Emitter } from '../../../src/domain/emitters/cocos2';
import { IR_VERSION, type IR } from '../../../src/domain/ir/schema';

function makeIr(): IR {
  return {
    version: IR_VERSION,
    generatedAt: '2026-01-01T00:00:00Z',
    sourceFileKey: 'test-file',
    frames: [
      {
        id: 'f1',
        name: 'Cocos2Frame',
        width: 200,
        height: 100,
        children: [
          {
            kind: 'sprite',
            id: 'sprite-1',
            name: 'icon',
            assetRef: 'icon.png',
            placement: { x: 10, y: 10, width: 20, height: 20 },
            opacity: 1,
            visible: true,
            extensions: {},
          },
        ],
        assets: [],
      },
    ],
  };
}

describe('CocosCreator2Emitter', () => {
  it('declares cocos2.4.x descriptor', () => {
    const emitter = new CocosCreator2Emitter();
    expect(emitter.descriptor.id).toBe('cocos-creator-2');
    expect(emitter.descriptor.engineVersions).toEqual(['2.4.x']);
  });

  it('emits prefab and meta files for cocos2.4 target', () => {
    const emitter = new CocosCreator2Emitter();
    const result = emitter.emit({
      ir: makeIr(),
      engineVersion: '2.4.x',
      settings: {
        assetsRootRelative: 'out',
        textureByAssetRef: new Map([
          ['icon.png', { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), width: 20, height: 20 }],
        ]),
      },
    });

    const paths = result.files.map((f) => f.path);
    expect(paths).toContain('out/prefabs/Cocos2Frame.prefab');
    expect(paths).toContain('out/prefabs/Cocos2Frame.prefab.meta');
    expect(paths).toContain('out/textures/icon.png');
    expect(paths).toContain('out/textures/icon.png.meta');

    const prefab = result.files.find((f) => f.path === 'out/prefabs/Cocos2Frame.prefab');
    const prefabText = new TextDecoder().decode(prefab!.data);
    expect(prefabText).toContain('"__type__": "cc.Sprite"');
    expect(prefabText).not.toContain('cc.UITransform');
    expect(prefabText).toMatch(/"_spriteFrame":\s*\{\s*"__uuid__":\s*"[0-9a-f-]{36}"/);

    const texMeta = result.files.find((f) => f.path === 'out/textures/icon.png.meta');
    const texMetaObj = JSON.parse(new TextDecoder().decode(texMeta!.data)) as {
      ver: string;
      subMetas: Record<string, { rawTextureUuid: string; uuid: string }>;
      uuid: string;
    };
    expect(texMetaObj.ver).toBe('2.3.5');
    expect(texMetaObj.subMetas['icon']).toBeDefined();
    expect(texMetaObj.subMetas['icon'].rawTextureUuid).toBe(texMetaObj.uuid);
  });

  it('emits atlas texture/meta and prefab sprite refs when atlasLayout is set', () => {
    const emitter = new CocosCreator2Emitter();
    const atlasLayout = {
      version: 1 as const,
      pages: [
        {
          atlasKey: 'atlas-0',
          pngFileBaseName: 'atlas-0.png',
          width: 64,
          height: 64,
          sprites: [
            {
              assetRef: 'icon.png',
              rect: { x: 4, y: 8, width: 20, height: 20 },
              sourceSize: { width: 20, height: 20 },
            },
          ],
        },
      ],
    };
    const result = emitter.emit({
      ir: makeIr(),
      engineVersion: '2.4.x',
      settings: {
        assetsRootRelative: 'out',
        atlasLayout,
        textureByAssetRef: new Map([
          ['atlas://atlas-0.png', { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), width: 64, height: 64 }],
        ]),
      },
    });

    const paths = result.files.map((f) => f.path);
    expect(paths).toContain('out/textures/atlas-0.png');
    expect(paths).toContain('out/textures/atlas-0.png.meta');
    expect(paths).toContain('out/textures/atlas-0.plist');
    expect(paths).not.toContain('out/textures/icon.png');

    const plistFile = result.files.find((f) => f.path === 'out/textures/atlas-0.plist');
    const plistText = new TextDecoder().decode(plistFile!.data);
    expect(plistText).toContain('<key>format</key>');
    expect(plistText).toContain('<integer>3</integer>');
    expect(plistText).toContain('<key>icon.png</key>');
    expect(plistText).toContain('{{4,8},{20,20}}');

    const texMeta = result.files.find((f) => f.path === 'out/textures/atlas-0.png.meta');
    const texMetaObj = JSON.parse(new TextDecoder().decode(texMeta!.data)) as {
      ver: string;
      uuid: string;
      width: number;
      height: number;
      subMetas: Record<string, { uuid: string; rawTextureUuid: string; trimX: number; trimY: number; width: number; height: number }>;
    };
    expect(texMetaObj.ver).toBe('2.3.5');
    expect(texMetaObj.width).toBe(64);
    expect(texMetaObj.height).toBe(64);
    expect(texMetaObj.subMetas['icon']).toBeDefined();
    expect(texMetaObj.subMetas['icon'].rawTextureUuid).toBe(texMetaObj.uuid);
    expect(texMetaObj.subMetas['icon'].trimX).toBe(4);
    expect(texMetaObj.subMetas['icon'].trimY).toBe(8);
    expect(texMetaObj.subMetas['icon'].width).toBe(20);
    expect(texMetaObj.subMetas['icon'].height).toBe(20);

    const sfUuid = texMetaObj.subMetas['icon'].uuid;
    const prefab = result.files.find((f) => f.path === 'out/prefabs/Cocos2Frame.prefab');
    const prefabText = new TextDecoder().decode(prefab!.data);
    expect(prefabText).toContain('"__type__": "cc.Sprite"');
    expect(prefabText).toContain(`"__uuid__": "${sfUuid}"`);
  });

  it('emits cocos2-compatible label component fields and font binding', () => {
    const emitter = new CocosCreator2Emitter();
    const ir: IR = {
      version: IR_VERSION,
      generatedAt: '2026-01-01T00:00:00Z',
      sourceFileKey: 'test-file',
      frames: [
        {
          id: 'f2',
          name: 'LabelFrame',
          width: 300,
          height: 200,
          children: [
            {
              kind: 'text',
              id: 'txt-1',
              name: 'Title',
              characters: 'Label',
              fontFamily: 'Arial',
              fontStyle: 'Regular',
              fontSize: 40,
              placement: { x: 0, y: 0, width: 100, height: 40 },
              opacity: 1,
              visible: true,
              extensions: {},
            },
          ],
          assets: [],
        },
      ],
    };

    const result = emitter.emit({
      ir,
      engineVersion: '2.4.x',
      settings: {
        assetsRootRelative: 'out',
        fontByKey: new Map([['Arial|Regular', { fileName: 'Arial.ttf', bytes: new Uint8Array([1, 2, 3]) }]]),
      },
    });

    const prefab = result.files.find((f) => f.path === 'out/prefabs/LabelFrame.prefab');
    const prefabText = new TextDecoder().decode(prefab!.data);
    expect(prefabText).toContain('"__type__": "cc.Label"');
    expect(prefabText).toContain('"_string": "Label"');
    expect(prefabText).toContain('"_N$string": "Label"');
    expect(prefabText).toContain('"_N$file": {');
    expect(prefabText).toContain('"_isSystemFontUsed": false');
    expect(prefabText).toContain('"_materials": [');
    expect(prefabText).toContain('"_srcBlendFactor": 770');
    expect(prefabText).toContain('"_lineHeight": 42');

    const prefabMeta = result.files.find((f) => f.path === 'out/prefabs/LabelFrame.prefab.meta');
    const prefabMetaObj = JSON.parse(new TextDecoder().decode(prefabMeta!.data)) as { ver: string };
    expect(prefabMetaObj.ver).toBe('1.2.7');
  });

  it('falls back to same-family font uuid when style does not exactly match', () => {
    const emitter = new CocosCreator2Emitter();
    const ir: IR = {
      version: IR_VERSION,
      generatedAt: '2026-01-01T00:00:00Z',
      sourceFileKey: 'test-file',
      frames: [
        {
          id: 'f3',
          name: 'LabelFallback',
          width: 300,
          height: 200,
          children: [
            {
              kind: 'text',
              id: 'txt-2',
              name: 'Title',
              characters: 'Fallback',
              fontFamily: 'Alibaba PuHuiTi 3.0',
              fontStyle: 'Regular',
              fontSize: 32,
              placement: { x: 0, y: 0, width: 100, height: 32 },
              opacity: 1,
              visible: true,
              extensions: {},
            },
          ],
          assets: [],
        },
      ],
    };

    const result = emitter.emit({
      ir,
      engineVersion: '2.4.x',
      settings: {
        assetsRootRelative: 'out',
        // 只有 Black 样式，故意与 Regular 不一致，测试 family 回退
        fontByKey: new Map([['Alibaba PuHuiTi 3.0|Black', { fileName: 'Alibaba.ttf', bytes: new Uint8Array([1]) }]]),
      },
    });

    const prefab = result.files.find((f) => f.path === 'out/prefabs/LabelFallback.prefab');
    const prefabText = new TextDecoder().decode(prefab!.data);
    expect(prefabText).toContain('"_N$file": {');
    expect(prefabText).toContain('"_isSystemFontUsed": false');
    expect(result.warnings.some((w) => w.level === 'info' && w.message.includes('family 回退匹配'))).toBe(true);
  });
});

