import { describe, expect, it } from 'vitest';
import {
  atlasTextureMapKey,
  generateCocos3Files,
  sanitizeTextureGroupPathSegment,
} from '../../../src/domain/emitters/cocos3/prefab';
import type { AtlasLayout } from '../../../src/domain/atlas/atlasLayout';
import { IR_VERSION, type IR } from '../../../src/domain/ir/schema';

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function irWithSprite(assetRef: string): IR {
  return {
    version: IR_VERSION,
    generatedAt: '2026-01-01T00:00:00Z',
    sourceFileKey: 'test-file',
    frames: [
      {
        id: 'f1',
        name: 'FrameA',
        width: 100,
        height: 50,
        children: [
          {
            kind: 'sprite',
            id: 's1',
            name: 'x',
            assetRef,
            placement: { x: 0, y: 0, width: 4, height: 4 },
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

function irWithSlicedSprite(assetRef: string): IR {
  return {
    version: IR_VERSION,
    generatedAt: '2026-01-01T00:00:00Z',
    sourceFileKey: 'test-file',
    frames: [
      {
        id: 'f1',
        name: 'SlicedFrame',
        width: 100,
        height: 50,
        children: [
          {
            kind: 'slicedSprite',
            id: 'sl1',
            name: 'nine',
            assetRef,
            slices: { top: 2, bottom: 2, left: 2, right: 2 },
            placement: { x: 0, y: 0, width: 40, height: 40 },
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

describe('sanitizeTextureGroupPathSegment', () => {
  it('returns empty for .. or . or all-stripped', () => {
    expect(sanitizeTextureGroupPathSegment('..')).toBe('');
    expect(sanitizeTextureGroupPathSegment('.')).toBe('');
    expect(sanitizeTextureGroupPathSegment('///')).toBe('');
  });

  it('strips slashes and applies same illegal-char pass as texture basename', () => {
    expect(sanitizeTextureGroupPathSegment('Shop/UI')).toBe('ShopUI');
    expect(sanitizeTextureGroupPathSegment('a<b')).toBe('a_b');
  });
});

describe('generateCocos3Files texture paths', () => {
  it('writes textures flat when textureSubdirByPrimaryGroup is off', () => {
    const ir = irWithSprite('textures/foo.png');
    const files = generateCocos3Files(ir, {
      assetsRootRelative: 'out',
      textureSubdirByPrimaryGroup: false,
      primaryGroupByAssetRef: { 'textures/foo.png': 'Shop_UI' },
      textureByAssetRef: new Map([['textures/foo.png', { bytes: pngBytes, width: 4, height: 4 }]]),
    });
    expect(files.some((f) => f.path === 'out/textures/foo.png')).toBe(true);
    expect(files.some((f) => f.path === 'out/textures/Shop_UI/foo.png')).toBe(false);
  });

  it('writes textures under primary group subdir when enabled (Record map)', () => {
    const ir = irWithSprite('textures/foo.png');
    const files = generateCocos3Files(ir, {
      assetsRootRelative: 'out',
      textureSubdirByPrimaryGroup: true,
      primaryGroupByAssetRef: { 'textures/foo.png': 'Shop_UI' },
      textureByAssetRef: new Map([['textures/foo.png', { bytes: pngBytes, width: 4, height: 4 }]]),
    });
    expect(files.some((f) => f.path === 'out/textures/Shop_UI/foo.png')).toBe(true);
    expect(files.some((f) => f.path === 'out/textures/foo.png')).toBe(false);
  });

  it('accepts ReadonlyMap for primaryGroupByAssetRef', () => {
    const ir = irWithSprite('a.png');
    const files = generateCocos3Files(ir, {
      assetsRootRelative: 'pack',
      textureSubdirByPrimaryGroup: true,
      primaryGroupByAssetRef: new Map([['a.png', 'HUD']]),
      textureByAssetRef: new Map([['a.png', { bytes: pngBytes, width: 1, height: 1 }]]),
    });
    expect(files.some((f) => f.path === 'pack/textures/HUD/a.png')).toBe(true);
  });

  it('emits PNG for slicedSprite assetRef with same dedupe key as sprite', () => {
    const ir = irWithSlicedSprite('panel.png');
    const files = generateCocos3Files(ir, {
      assetsRootRelative: 'out',
      textureByAssetRef: new Map([['panel.png', { bytes: pngBytes, width: 10, height: 10 }]]),
    });
    expect(files.some((f) => f.path === 'out/textures/panel.png')).toBe(true);
    expect(files.some((f) => f.path.endsWith('textures/panel.png.meta'))).toBe(true);
  });

  it('prefab JSON references sprite-frame by uuid only (no texture file paths)', () => {
    const ir = irWithSprite('icon.png');
    const files = generateCocos3Files(ir, {
      assetsRootRelative: 'assets/ui',
      textureSubdirByPrimaryGroup: true,
      primaryGroupByAssetRef: { 'icon.png': 'HUD_Main' },
      textureByAssetRef: new Map([['icon.png', { bytes: pngBytes, width: 4, height: 4 }]]),
    });
    expect(files.some((f) => f.path === 'assets/ui/textures/HUD_Main/icon.png')).toBe(true);
    const prefabText = new TextDecoder().decode(files.find((f) => f.path.endsWith('FrameA.prefab'))!.data);
    expect(prefabText).toMatch(
      /"_spriteFrame":\s*\{[^}]*"__uuid__":\s*"[0-9a-f-]{36}@f9941"[^}]*"__expectedType__":\s*"cc.SpriteFrame"/,
    );
    expect(prefabText).not.toContain('assets/ui');
    expect(prefabText).not.toContain('textures/HUD_Main');
    expect(prefabText).not.toContain('icon.png');
  });

  it('sprite uses SizeMode RAW and UITransform matches texture/sourceSize (not Figma placement when PNG differs)', () => {
    const ir = irWithSprite('icon.png');
    const sp = ir.frames[0]!.children[0]!;
    sp.placement = { ...sp.placement, width: 99, height: 88 };
    const files = generateCocos3Files(ir, {
      assetsRootRelative: 'out',
      textureByAssetRef: new Map([['icon.png', { bytes: pngBytes, width: 4, height: 4 }]]),
    });
    const prefabText = new TextDecoder().decode(files.find((f) => f.path.endsWith('FrameA.prefab'))!.data);
    const doc = JSON.parse(prefabText) as Array<Record<string, unknown> & { __type__: string; node?: { __id__: number } }>;
    const sprite = doc.find((x) => x.__type__ === 'cc.Sprite');
    expect(sprite?._sizeMode).toBe(2);
    expect(sprite?._isTrimmedMode).toBe(false);
    const nodeId = sprite?.node?.__id__;
    const uit = doc.find(
      (x) => x.__type__ === 'cc.UITransform' && x.node && (x.node as { __id__: number }).__id__ === nodeId,
    );
    const cs = uit?._contentSize as { width: number; height: number } | undefined;
    expect(cs?.width).toBe(4);
    expect(cs?.height).toBe(4);
  });

  it('label line height is fontSize+2 and IR outline maps to Label outline', () => {
    const ir: IR = {
      version: IR_VERSION,
      generatedAt: '2026-01-01T00:00:00Z',
      sourceFileKey: 'test',
      frames: [
        {
          id: 'f-label',
          name: 'LFrame',
          width: 200,
          height: 100,
          children: [
            {
              kind: 'text',
              id: 't1',
              name: 't',
              characters: 'Hi',
              fontFamily: 'Arial',
              fontStyle: 'Regular',
              fontSize: 20,
              placement: { x: 0, y: 0, width: 50, height: 80 },
              opacity: 1,
              visible: true,
              extensions: {},
              outline: { width: 3, color: { r: 1, g: 0, b: 0, a: 1 } },
            },
          ],
          assets: [],
        },
      ],
    };
    const files = generateCocos3Files(ir, { assetsRootRelative: 'out' });
    const prefabText = new TextDecoder().decode(files.find((f) => f.path.endsWith('LFrame.prefab'))!.data);
    expect(prefabText).toContain('"_lineHeight": 22');
    expect(prefabText).toContain('"_enableOutline": true');
    expect(prefabText).toContain('"_outlineWidth": 3');
    expect(prefabText).toMatch(/"_outlineColor":\s*\{[^}]*"r":\s*255/);
  });

  it('atlas mode writes PNG(texture-only meta), plist format2, plist.sprite-atlas meta, prefab refs plist@sub sprite-frames', () => {
    const assetRef = 'textures/icon.png';
    const ir = irWithSprite(assetRef);
    const atlasLayout: AtlasLayout = {
      version: 1,
      pages: [
        {
          atlasKey: 'atlas-0',
          pngFileBaseName: 'atlas-0.png',
          width: 64,
          height: 64,
          sprites: [
            {
              assetRef,
              rect: { x: 10, y: 12, width: 4, height: 4 },
              sourceSize: { width: 4, height: 4 },
            },
          ],
        },
      ],
    };
    const files = generateCocos3Files(ir, {
      assetsRootRelative: 'out',
      atlasLayout,
      textureByAssetRef: new Map([
        [atlasTextureMapKey('atlas-0'), { bytes: pngBytes, width: 64, height: 64 }],
      ]),
    });
    expect(files.some((f) => f.path === 'out/textures/atlas-0.png')).toBe(true);
    expect(files.some((f) => f.path === 'out/textures/atlas-0.plist')).toBe(true);
    expect(files.some((f) => f.path === 'out/textures/atlas-0.plist.meta')).toBe(true);
    expect(files.some((f) => f.path === 'out/textures/icon.png')).toBe(false);
    const plistText = new TextDecoder().decode(files.find((f) => f.path === 'out/textures/atlas-0.plist')!.data);
    expect(plistText).toContain('<integer>2</integer>');
    expect(plistText).toContain('<key>icon.png</key>');
    expect(plistText).toContain('{{10,12},{4,4}}');
    const pngMeta = JSON.parse(new TextDecoder().decode(files.find((f) => f.path === 'out/textures/atlas-0.png.meta')!.data)) as {
      uuid: string;
      files: string[];
      subMetas: Record<string, { importer?: string }>;
    };
    expect(pngMeta.files).toEqual(['.json', 'atlas-0.png']);
    expect(Object.values(pngMeta.subMetas).some((m) => m.importer === 'texture')).toBe(true);
    const texSub = Object.values(pngMeta.subMetas).find((m) => m.importer === 'texture') as
      | { userData?: { minfilter?: string; magfilter?: string } }
      | undefined;
    expect(texSub?.userData?.minfilter).toBe('linear');
    expect(texSub?.userData?.magfilter).toBe('linear');
    expect(Object.values(pngMeta.subMetas).some((m) => m.importer === 'sprite-frame')).toBe(false);

    const plistMeta = JSON.parse(
      new TextDecoder().decode(files.find((f) => f.path === 'out/textures/atlas-0.plist.meta')!.data),
    ) as {
      uuid: string;
      importer: string;
      subMetas: Record<string, { importer?: string; uuid?: string; name?: string; userData?: Record<string, unknown> }>;
      userData: Record<string, unknown>;
    };
    expect(plistMeta.importer).toBe('sprite-atlas');
    expect(plistMeta.userData.format).toBe(2);
    expect(plistMeta.userData.uuid).toBe(plistMeta.uuid);
    expect(String(plistMeta.userData.textureUuid)).toMatch(new RegExp(`^${pngMeta.uuid}@6c48a$`));
    const spriteSub = Object.values(plistMeta.subMetas).find(
      (m) => m.importer === 'sprite-frame' && m.name === 'icon',
    );
    expect(spriteSub?.uuid).toMatch(new RegExp(`^${plistMeta.uuid}@[0-9a-f]{5}$`));
    const sud = spriteSub?.userData;
    expect(sud?.trimX).toBe(10);
    expect(sud?.trimY).toBe(12);
    expect(sud?.width).toBe(4);
    expect(sud?.height).toBe(4);
    expect(sud?.atlasUuid).toBe(plistMeta.uuid);
    expect(sud?.imageUuidOrDatabaseUri).toBe(`${pngMeta.uuid}@6c48a`);

    for (const [key, row] of Object.entries(plistMeta.subMetas)) {
      const m = row as { importer?: string; uuid?: string; id?: string };
      if (m.importer !== 'sprite-frame') {
        continue;
      }
      expect(m.id).toBe(key);
      expect(m.uuid).toBe(`${plistMeta.uuid}@${key}`);
    }

    const prefabText = new TextDecoder().decode(files.find((f) => f.path.endsWith('FrameA.prefab'))!.data);
    expect(prefabText).toContain(`"__uuid__": "${spriteSub!.uuid}"`);
    expect(prefabText).toContain('"__expectedType__": "cc.SpriteFrame"');
    expect(prefabText).toContain(`"__uuid__": "${plistMeta.uuid}"`);
    expect(prefabText).toContain('"__expectedType__": "cc.SpriteAtlas"');
    expect(prefabText).not.toContain('"_atlas": null');
    expect(prefabText).not.toContain('textures/');
  });

  it('atlas mode with two sprites emits two distinct sprite-frame subMetas referenced in prefab', () => {
    const ir: IR = {
      version: IR_VERSION,
      generatedAt: '2026-01-01T00:00:00Z',
      sourceFileKey: 'test-file',
      frames: [
        {
          id: 'f1',
          name: 'AtlasFrame',
          width: 100,
          height: 50,
          children: [
            {
              kind: 'sprite',
              id: 's-a',
              name: 'A',
              assetRef: 'a.png',
              placement: { x: 0, y: 0, width: 16, height: 16 },
              opacity: 1,
              visible: true,
              extensions: {},
            },
            {
              kind: 'sprite',
              id: 's-b',
              name: 'B',
              assetRef: 'b.png',
              placement: { x: 20, y: 0, width: 16, height: 16 },
              opacity: 1,
              visible: true,
              extensions: {},
            },
          ],
          assets: [],
        },
      ],
    };

    const atlasLayout: AtlasLayout = {
      version: 1,
      pages: [
        {
          atlasKey: 'atlas-0',
          pngFileBaseName: 'atlas-0.png',
          width: 64,
          height: 64,
          sprites: [
            {
              assetRef: 'a.png',
              rect: { x: 0, y: 0, width: 16, height: 16 },
              sourceSize: { width: 16, height: 16 },
            },
            {
              assetRef: 'b.png',
              rect: { x: 16, y: 0, width: 16, height: 16 },
              sourceSize: { width: 16, height: 16 },
            },
          ],
        },
      ],
    };

    const files = generateCocos3Files(ir, {
      assetsRootRelative: 'out',
      atlasLayout,
      textureByAssetRef: new Map([
        [atlasTextureMapKey('atlas-0'), { bytes: pngBytes, width: 64, height: 64 }],
      ]),
    });

    expect(files.some((f) => f.path === 'out/textures/atlas-0.plist')).toBe(true);
    expect(files.some((f) => f.path === 'out/textures/atlas-0.plist.meta')).toBe(true);

    const atlasMetaObj = JSON.parse(
      new TextDecoder().decode(files.find((f) => f.path === 'out/textures/atlas-0.png.meta')!.data),
    ) as {
      uuid: string;
      subMetas: Record<string, { importer?: string; uuid?: string; displayName?: string; userData?: { atlasUuid?: string } }>;
    };
    expect(Object.values(atlasMetaObj.subMetas).filter((m) => m.importer === 'sprite-frame')).toHaveLength(0);

    const plistMetaObj = JSON.parse(
      new TextDecoder().decode(files.find((f) => f.path === 'out/textures/atlas-0.plist.meta')!.data),
    ) as {
      uuid: string;
      subMetas: Record<string, { importer?: string; uuid?: string; name?: string }>;
    };
    const spriteSubMetas = Object.values(plistMetaObj.subMetas).filter((m) => m.importer === 'sprite-frame');
    expect(spriteSubMetas).toHaveLength(2);
    expect(new Set(spriteSubMetas.map((m) => m.name))).toEqual(new Set(['a', 'b']));
    for (const m of spriteSubMetas) {
      expect(m.uuid).toMatch(new RegExp(`^${plistMetaObj.uuid}@[0-9a-f]{5}$`));
    }

    const prefabText = new TextDecoder().decode(files.find((f) => f.path.endsWith('AtlasFrame.prefab'))!.data);
    expect(prefabText).toContain('"__expectedType__": "cc.SpriteAtlas"');
    expect(prefabText).not.toContain('"_atlas": null');
    const sfMatches = [...prefabText.matchAll(/"_spriteFrame":\s*\{\s*"__uuid__":\s*"([^"]+)"/g)].map((m) => m[1]!);
    expect(sfMatches).toHaveLength(2);
    expect(new Set(sfMatches)).toEqual(new Set(spriteSubMetas.map((m) => m.uuid!)));
    for (const uuid of sfMatches) {
      expect(uuid).toMatch(new RegExp(`^${plistMetaObj.uuid}@[0-9a-f]{5}$`));
    }
  });
});
