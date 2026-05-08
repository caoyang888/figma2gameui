import { describe, expect, it } from 'vitest';
import type { AtlasLayout } from '../../../src/domain/atlas/atlasLayout';
import { UnityEmitter } from '../../../src/domain/emitters/unity';
import { IR_VERSION, type IR } from '../../../src/domain/ir/schema';

function makeMinimalIr(): IR {
  return {
    version: IR_VERSION,
    generatedAt: '2026-01-01T00:00:00Z',
    sourceFileKey: 'test-file',
    frames: [
      {
        id: 'frame-1',
        name: 'Main/UI',
        width: 1280,
        height: 720,
        children: [
          {
            kind: 'sprite',
            id: 'node-sprite',
            name: 'Logo',
            assetRef: 'logo.png',
            placement: { x: 10, y: 20, width: 100, height: 40 },
            opacity: 1,
            visible: true,
            extensions: {},
          },
          {
            kind: 'text',
            id: 'node-text',
            name: 'Title',
            characters: 'Hello',
            fontFamily: 'Arial',
            fontStyle: 'Regular',
            fontSize: 24,
            placement: { x: 0, y: 0, width: 220, height: 48 },
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

describe('UnityEmitter', () => {
  it('exposes supported unity version profiles', () => {
    const emitter = new UnityEmitter();
    expect(emitter.descriptor.id).toBe('unity');
    expect(emitter.descriptor.engineVersions).toEqual(['2019.4.x', '2020.1.x', '2021.1.x', '2022.1.x']);
  });

  it('exports prefabs, textures and fonts for unity 2021.x minimum profile', () => {
    const emitter = new UnityEmitter();
    const output = emitter.emit({
      ir: makeMinimalIr(),
      engineVersion: '2021.1.x',
      settings: {
        assetsRootRelative: '_figma_export',
        prefabsRelativeDir: 'prefabs',
        texturesRelativeDir: 'textures',
        fontsRelativeDir: 'fonts',
        textureByAssetRef: new Map([
          ['logo.png', { bytes: new Uint8Array([1, 2, 3]), width: 100, height: 40 }],
        ]),
        fontByKey: new Map([
          ['Arial|Regular', { fileName: 'Arial.ttf', bytes: new Uint8Array([4, 5, 6]) }],
        ]),
        includePrefabs: true,
        includeTextures: true,
        includeFonts: true,
      },
    });

    const paths = output.files.map((f) => f.path).sort();
    expect(paths).toContain('_figma_export/prefabs/Main_UI.prefab');
    expect(paths).toContain('_figma_export/prefabs/Main_UI.prefab.meta');
    expect(paths).toContain('_figma_export/textures/logo.png');
    expect(paths).toContain('_figma_export/textures/logo.png.meta');
    expect(paths).toContain('_figma_export/fonts/Arial.ttf');
    expect(paths).toContain('_figma_export/fonts/Arial.ttf.meta');
    expect(paths).toContain('_figma_export/unity-export.manifest.json');

    const prefabFile = output.files.find((f) => f.path.endsWith('Main_UI.prefab'));
    const prefabText = new TextDecoder().decode(prefabFile!.data);
    expect(prefabText).toContain('%YAML 1.1');
    expect(prefabText).toContain('RectTransform:');
    expect(prefabText).toContain('UnityEngine.UI::UnityEngine.UI.Image');
    expect(prefabText).toContain('m_Script: {fileID: 11500000, guid: 5f7201a12d95ffc409449d95f23cf332, type: 3}');
    expect(prefabText).toContain('m_Text: Hello');
    expect(prefabText).toContain('m_Font: {fileID: 12800000, guid:');
    expect(prefabText).toContain('type: 3');
    expect(prefabText).toContain('m_BestFit: 0');
    expect(prefabText).toContain('m_VerticalOverflow: 1');
    expect(prefabText).not.toContain('FigmaText ');
    expect(prefabText).not.toContain('SpriteRenderer:');
    expect(prefabText).not.toMatch(/m_Children:\s*\n\s*-\s*\{fileID:\s*(\d+)\}\n\s*-\s*\{fileID:\s*\1\}/);

    const manifestFile = output.files.find((f) => f.path.endsWith('unity-export.manifest.json'));
    const manifest = JSON.parse(new TextDecoder().decode(manifestFile!.data)) as { runtimeProfile: string };
    expect(manifest.runtimeProfile).toBe('2021.1.x');

    const textureMeta = output.files.find((f) => f.path.endsWith('textures/logo.png.meta'));
    const textureMetaText = new TextDecoder().decode(textureMeta!.data);
    expect(textureMetaText).toContain('textureType: 8');
    expect(textureMetaText).toContain('spriteMode: 1');
    expect(textureMetaText).toContain('nPOTScale: 0');
    expect(textureMetaText).toContain('buildTarget: Android');
    expect(textureMetaText).not.toContain('spriteSheet:');
  });

  it('atlas layout emits spriteatlas assets and keeps standalone sprite textures', () => {
    const ir: IR = {
      version: IR_VERSION,
      generatedAt: '2026-01-01T00:00:00Z',
      sourceFileKey: 'test-file',
      frames: [
        {
          id: 'frame-1',
          name: 'AtlasFrame',
          width: 800,
          height: 600,
          children: [
            {
              kind: 'sprite',
              id: 's-a',
              name: 'A',
              assetRef: 'a.png',
              placement: { x: 0, y: 0, width: 32, height: 32 },
              opacity: 1,
              visible: true,
              extensions: {},
            },
            {
              kind: 'sprite',
              id: 's-b',
              name: 'B',
              assetRef: 'b.png',
              placement: { x: 40, y: 0, width: 32, height: 32 },
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

    const emitter = new UnityEmitter();
    const output = emitter.emit({
      ir,
      engineVersion: '2021.1.x',
      settings: {
        assetsRootRelative: '_figma_export',
        prefabsRelativeDir: 'prefabs',
        texturesRelativeDir: 'textures',
        atlasLayout,
        textureByAssetRef: new Map([
          ['atlas://atlas-0.png', { bytes: new Uint8Array([137, 80, 78, 71]), width: 64, height: 64 }],
          ['a.png', { bytes: new Uint8Array([1, 2, 3]), width: 16, height: 16 }],
          ['b.png', { bytes: new Uint8Array([4, 5, 6]), width: 16, height: 16 }],
        ]),
        includePrefabs: true,
        includeTextures: true,
        includeFonts: false,
      },
    });

    const paths = output.files.map((f) => f.path).sort();
    expect(paths).not.toContain('_figma_export/textures/atlas-0.png');
    expect(paths).not.toContain('_figma_export/textures/atlas-0.png.meta');
    expect(paths).toContain('_figma_export/textures/atlas-0.spriteatlas');
    expect(paths).toContain('_figma_export/textures/atlas-0.spriteatlas.meta');
    expect(paths).toContain('_figma_export/textures/a.png');
    expect(paths).toContain('_figma_export/textures/b.png');
    const manifestFile = output.files.find((f) => f.path.endsWith('unity-export.manifest.json'));
    const manifest = JSON.parse(new TextDecoder().decode(manifestFile!.data)) as {
      output?: { spriteAtlases?: string[] };
    };
    expect(manifest.output?.spriteAtlases).toContain('_figma_export/textures/atlas-0.spriteatlas');

    const spriteAtlasFile = output.files.find((f) => f.path.endsWith('textures/atlas-0.spriteatlas'));
    const spriteAtlasText = new TextDecoder().decode(spriteAtlasFile!.data);
    const atlasPackableGuids = [...spriteAtlasText.matchAll(/guid: ([a-f0-9]{32}), type: 3/g)].map((m) => m[1]);
    expect(atlasPackableGuids.length).toBe(2);
    expect(new Set(atlasPackableGuids).size).toBe(2);

    const prefabFile = output.files.find((f) => f.path.endsWith('AtlasFrame.prefab'));
    const prefabText = new TextDecoder().decode(prefabFile!.data);
    const spriteRefs = [...prefabText.matchAll(/m_Sprite: \{fileID: (\d+), guid: ([a-f0-9]{32}), type: 3\}/g)];
    expect(spriteRefs.length).toBe(2);
    expect(spriteRefs[0]![1]).toBe('21300000');
    expect(spriteRefs[1]![1]).toBe('21300000');
    expect(spriteRefs[0]![2]).not.toBe(spriteRefs[1]![2]);
    expect(prefabText).not.toContain('m_Sprite: {fileID: 21300002');
  });

  it('atlas layout still emits spriteatlas when page is large', () => {
    const emitter = new UnityEmitter();
    const output = emitter.emit({
      ir: makeMinimalIr(),
      engineVersion: '2022.1.x',
      settings: {
        assetsRootRelative: '_figma_export',
        includePrefabs: false,
        includeTextures: true,
        includeFonts: false,
        atlasLayout: {
          version: 1,
          pages: [
            {
              atlasKey: 'atlas-big',
              pngFileBaseName: 'atlas-big.png',
              width: 3000,
              height: 3000,
              sprites: [],
            },
          ],
        } satisfies AtlasLayout,
        textureByAssetRef: new Map([
          ['atlas://atlas-big.png', { bytes: new Uint8Array([137, 80, 78, 71]), width: 3000, height: 3000 }],
          ['logo.png', { bytes: new Uint8Array([1, 2, 3]), width: 100, height: 40 }],
        ]),
      },
    });

    const spriteAtlas = output.files.find((f) => f.path.endsWith('textures/atlas-big.spriteatlas'));
    expect(spriteAtlas).toBeDefined();
    const textures = output.files.filter((f) => f.path.includes('/textures/') && !f.path.endsWith('.meta'));
    expect(textures.map((f) => f.path)).toContain('_figma_export/textures/logo.png');
    expect(textures.map((f) => f.path)).not.toContain('_figma_export/textures/atlas-big.png');
  });

  it('falls back to minimum runtime profile for unity 2022.x family', () => {
    const emitter = new UnityEmitter();
    const output = emitter.emit({
      ir: makeMinimalIr(),
      engineVersion: '2022.3.10f1',
      settings: {
        assetsRootRelative: 'out',
        includePrefabs: true,
        includeTextures: false,
        includeFonts: false,
      },
    });

    const manifestFile = output.files.find((f) => f.path.endsWith('unity-export.manifest.json'));
    const manifest = JSON.parse(new TextDecoder().decode(manifestFile!.data)) as { runtimeProfile: string };
    expect(manifest.runtimeProfile).toBe('2022.1.x');
  });

  it('maps constraints to stretched RectTransform anchors', () => {
    const emitter = new UnityEmitter();
    const ir: IR = {
      version: IR_VERSION,
      generatedAt: '2026-01-01T00:00:00Z',
      sourceFileKey: 'test-file',
      frames: [
        {
          id: 'frame-1',
          name: 'ConstraintFrame',
          width: 1000,
          height: 500,
          children: [
            {
              kind: 'container',
              id: 'node-constraint',
              name: 'StretchNode',
              placement: { x: 100, y: 50, width: 700, height: 400 },
              opacity: 1,
              visible: true,
              extensions: {
                constraints: {
                  horizontal: 'stretch',
                  vertical: 'stretch',
                  base: {
                    horizontal: { parent: 1000, pos: 100, size: 700 },
                    vertical: { parent: 500, pos: 50, size: 400 },
                  },
                  widgetNumbers: {
                    left: 100,
                    right: 200,
                    top: 50,
                    bottom: 50,
                    horizontalCenter: -50,
                    verticalCenter: 0,
                  },
                },
              },
              children: [],
            },
          ],
          assets: [],
        },
      ],
    };
    const output = emitter.emit({
      ir,
      engineVersion: '2019.4.x',
      settings: { assetsRootRelative: 'out', includePrefabs: true, includeTextures: false, includeFonts: false },
    });
    const prefab = output.files.find((f) => f.path.endsWith('.prefab'));
    const txt = new TextDecoder().decode(prefab!.data);
    expect(txt).toContain('m_AnchorMin: {x: 0.000, y: 0.000}');
    expect(txt).toContain('m_AnchorMax: {x: 1.000, y: 1.000}');
    expect(txt).toContain('m_SizeDelta: {x: 0.000, y: 0.000}');
  });
});
