import { validateAssetsRelativeRoot } from '../../../shared/pathValidation';
import { encodeUtf8 } from '../../../shared/utf8';
import type { OutputFile, ReportEntry } from '../../../shared/types';
import type { IR, IrNode, IrSprite, IrText } from '../../ir/schema';
import type { AtlasLayout, AtlasSpriteEntry } from '../../atlas/atlasLayout';
import { allocatePlistFrameName, buildTexturePackerPlistXml } from '../../atlas/texturePackerPlist';

type TextureBytesPayload = {
  bytes: Uint8Array;
  width: number;
  height: number;
};

type FontBytesPayload = {
  fileName: string;
  bytes: Uint8Array;
};

export type Cocos2EmitterSettings = {
  assetsRootRelative: string;
  prefabsRelativeDir?: string;
  texturesRelativeDir?: string;
  fontsRelativeDir?: string;
  frameNameSanitize?: (name: string) => string;
  textureByAssetRef?: ReadonlyMap<string, TextureBytesPayload>;
  fontByKey?: ReadonlyMap<string, FontBytesPayload>;
  includePrefabs?: boolean;
  includeTextures?: boolean;
  includeFonts?: boolean;
  engineVersion?: string;
  /**
   * 合图布局；与 `textureByAssetRef` 中 `atlas://${atlasKey}.png` 键配合（与 Cocos3 / packAtlases 约定一致）。
   */
  atlasLayout?: AtlasLayout;
};

export type Cocos2GenerateResult = {
  files: OutputFile[];
  warnings: ReportEntry[];
};

/** `Sprite.SizeMode.TRIMMED`（CUSTOM=0, TRIMMED=1, RAW=2）。 */
const CC2_SPRITE_SIZE_MODE_TRIMMED = 1;

const DEFAULT_SPRITE_MATERIAL_UUID = 'eca5d2f2-8ef6-41c2-bbe6-f9c79d09c432';

function randomHex(len: number): string {
  const bytes = new Uint8Array(Math.ceil(len / 2));
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = (Math.random() * 256) | 0;
    }
  }
  const raw = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return raw.slice(0, len);
}

function newUuid(): string {
  return `${randomHex(8)}-${randomHex(4)}-${randomHex(4)}-${randomHex(4)}-${randomHex(12)}`;
}

function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join('/');
}

function defaultFrameNameSanitize(name: string): string {
  const t = (name || 'unnamed').trim();
  return (t.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 120) || 'unnamed');
}

function safeFileName(pathLike: string): string {
  const parts = pathLike.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? pathLike;
}

function fileBaseName(pathLike: string): string {
  const f = safeFileName(pathLike);
  return f.replace(/\.[^.]+$/, '') || 'sprite';
}

/** 与 `packAtlases` / Cocos3 `atlasTextureMapKey` 一致。 */
function atlasTextureMapKey(atlasKey: string): string {
  return `atlas://${atlasKey}.png`;
}

function makeTextureMeta(fileName: string, textureUuid: string, spriteFrameUuid: string, width: number, height: number): string {
  const subName = fileBaseName(fileName);
  return `${JSON.stringify(
    {
      ver: '2.3.5',
      uuid: textureUuid,
      type: 'sprite',
      wrapMode: 'clamp',
      filterMode: 'bilinear',
      premultiplyAlpha: false,
      genMipmaps: false,
      packable: true,
      width,
      height,
      platformSettings: {},
      subMetas: {
        [subName]: {
          ver: '1.0.4',
          uuid: spriteFrameUuid,
          rawTextureUuid: textureUuid,
          trimType: 'auto',
          trimThreshold: 1,
          rotated: false,
          offsetX: 0,
          offsetY: 0,
          trimX: 0,
          trimY: 0,
          width,
          height,
          rawWidth: width,
          rawHeight: height,
          borderTop: 0,
          borderBottom: 0,
          borderLeft: 0,
          borderRight: 0,
          subMetas: {},
        },
      },
    },
    null,
    2,
  )}\n`;
}

/**
 * 单张合图 PNG：根 meta 与 {@link makeTextureMeta} 同风格（ver 2.3.5、type sprite），
 * `subMetas` 内为每个子图 rect 一条 sprite-frame 记录（uuid 供 prefab 引用）。
 */
function makeAtlasPageTextureMeta(params: {
  textureUuid: string;
  pageWidth: number;
  pageHeight: number;
  sprites: Array<{ subMetaKey: string; spriteFrameUuid: string; entry: AtlasSpriteEntry }>;
}): string {
  const { textureUuid, pageWidth, pageHeight, sprites } = params;
  const subMetas: Record<string, unknown> = {};
  for (const s of sprites) {
    const { rect, sourceSize } = s.entry;
    subMetas[s.subMetaKey] = {
      ver: '1.0.4',
      uuid: s.spriteFrameUuid,
      rawTextureUuid: textureUuid,
      trimType: 'auto',
      trimThreshold: 1,
      rotated: false,
      offsetX: 0,
      offsetY: 0,
      trimX: rect.x,
      trimY: rect.y,
      width: rect.width,
      height: rect.height,
      rawWidth: sourceSize.width,
      rawHeight: sourceSize.height,
      borderTop: 0,
      borderBottom: 0,
      borderLeft: 0,
      borderRight: 0,
      subMetas: {},
    };
  }
  return `${JSON.stringify(
    {
      ver: '2.3.5',
      uuid: textureUuid,
      type: 'sprite',
      wrapMode: 'clamp',
      filterMode: 'bilinear',
      premultiplyAlpha: false,
      genMipmaps: false,
      packable: true,
      width: pageWidth,
      height: pageHeight,
      platformSettings: {},
      subMetas,
    },
    null,
    2,
  )}\n`;
}

function allocateSubMetaKeyForAtlasSprite(assetRef: string, used: Set<string>): string {
  const base = fileBaseName(assetRef) || 'sprite';
  let key = base;
  let n = 2;
  while (used.has(key)) {
    key = `${base}_${n}`;
    n += 1;
  }
  used.add(key);
  return key;
}

function emitAtlasPageTexturesCocos2(
  settings: Cocos2EmitterSettings,
  root: string,
  texturesDir: string,
  texMap: ReadonlyMap<string, TextureBytesPayload>,
  spriteUuidByAssetRef: Map<string, string>,
  out: OutputFile[],
): void {
  const layout = settings.atlasLayout;
  if (!layout) return;

  const pages = [...layout.pages].sort((a, b) => (a.atlasKey < b.atlasKey ? -1 : a.atlasKey > b.atlasKey ? 1 : 0));
  for (const page of pages) {
    const mapKey = atlasTextureMapKey(page.atlasKey);
    const payload = texMap.get(mapKey);
    if (!payload) {
      continue;
    }
    const fileName = page.pngFileBaseName || `${page.atlasKey}.png`;
    const texRel = joinPath(root, texturesDir, fileName);
    const textureUuid = newUuid();
    const orderedSprites = [...page.sprites].sort((a, b) =>
      a.assetRef < b.assetRef ? -1 : a.assetRef > b.assetRef ? 1 : 0,
    );
    const usedKeys = new Set<string>();
    const bindings: Array<{ subMetaKey: string; spriteFrameUuid: string; entry: AtlasSpriteEntry }> = [];
    for (const entry of orderedSprites) {
      const subMetaKey = allocateSubMetaKeyForAtlasSprite(entry.assetRef, usedKeys);
      const spriteFrameUuid = newUuid();
      bindings.push({ subMetaKey, spriteFrameUuid, entry });
      spriteUuidByAssetRef.set(entry.assetRef, spriteFrameUuid);
    }
    out.push({ path: texRel, data: payload.bytes });
    out.push({
      path: `${texRel}.meta`,
      data: encodeUtf8(
        makeAtlasPageTextureMeta({
          textureUuid,
          pageWidth: page.width,
          pageHeight: page.height,
          sprites: bindings,
        }),
      ),
    });
    const usedPlistNames = new Set<string>();
    const plistFrames = orderedSprites.map((entry) => ({
      frameName: allocatePlistFrameName(entry.assetRef, usedPlistNames),
      entry,
    }));
    const plistPath = texRel.toLowerCase().endsWith('.png') ? `${texRel.slice(0, -4)}.plist` : `${texRel}.plist`;
    out.push({
      path: plistPath,
      data: encodeUtf8(
        buildTexturePackerPlistXml({
          textureFileName: fileName,
          textureWidth: page.width,
          textureHeight: page.height,
          frames: plistFrames,
        }),
      ),
    });
  }
}

function makePrefabMeta(prefabUuid: string): string {
  return `${JSON.stringify(
    {
      ver: '1.2.7',
      uuid: prefabUuid,
      optimizationPolicy: 'AUTO',
      asyncLoadAssets: false,
      readonly: false,
      subMetas: {},
    },
    null,
    2,
  )}\n`;
}

function makeFontMeta(fontUuid: string): string {
  return `${JSON.stringify(
    {
      ver: '2.1.0',
      uuid: fontUuid,
      type: 'ttf',
      subMetas: {},
    },
    null,
    2,
  )}\n`;
}

function fontKeyFromTextNode(node: IrText): string {
  return `${node.fontFamily}|${node.fontStyle}`;
}

function fontFamilyFromKey(key: string): string {
  const idx = key.indexOf('|');
  return idx >= 0 ? key.slice(0, idx) : key;
}

function resolveLabelFontUuid(
  textNode: IrText,
  fontUuidByKey: ReadonlyMap<string, string>,
): { fontUuid?: string; exactMatched: boolean } {
  const exactKey = fontKeyFromTextNode(textNode);
  const exact = fontUuidByKey.get(exactKey);
  if (exact) {
    return { fontUuid: exact, exactMatched: true };
  }

  const family = textNode.fontFamily;
  for (const [key, uuid] of fontUuidByKey.entries()) {
    if (fontFamilyFromKey(key) === family) {
      return { fontUuid: uuid, exactMatched: false };
    }
  }
  return { fontUuid: undefined, exactMatched: false };
}

function buildNodeBase(node: IrNode, parentNodeId: number | null, x: number, y: number): Record<string, unknown> {
  return {
    __type__: 'cc.Node',
    _name: defaultFrameNameSanitize(node.name),
    _objFlags: 0,
    _parent: parentNodeId !== null ? { __id__: parentNodeId } : null,
    _children: [],
    _active: node.visible !== false,
    _components: [],
    _prefab: null,
    _opacity: Math.max(0, Math.min(255, Math.round(node.opacity * 255))),
    _color: { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 },
    _contentSize: { __type__: 'cc.Size', width: node.placement.width, height: node.placement.height },
    _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 },
    _trs: { __type__: 'TypedArray', ctor: 'Float64Array', array: [x, y, 0, 0, 0, 0, 1, 1, 1, 1] },
    _eulerAngles: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
    _skewX: 0,
    _skewY: 0,
    _is3DNode: false,
    _groupIndex: 0,
    groupIndex: 0,
    _id: '',
  };
}

function buildLabelComponent(t: IrText, nodeId: number, fontUuid?: string): Record<string, unknown> {
  const fz = Math.max(1, Math.round(Number(t.fontSize)));
  return {
    __type__: 'cc.Label',
    _name: '',
    _objFlags: 0,
    node: { __id__: nodeId },
    _enabled: true,
    _materials: [{ __uuid__: DEFAULT_SPRITE_MATERIAL_UUID }],
    _srcBlendFactor: 770,
    _dstBlendFactor: 771,
    _useOriginalSize: false,
    _string: t.characters,
    _N$string: t.characters,
    _fontSize: fz,
    _lineHeight: fz + 2,
    _enableWrapText: true,
    _N$file: fontUuid ? { __uuid__: fontUuid } : null,
    _isSystemFontUsed: !fontUuid,
    _spacingX: 0,
    _batchAsBitmap: false,
    _styleFlags: 0,
    _underlineHeight: 0,
    _N$horizontalAlign: 0,
    _N$verticalAlign: 1,
    _N$fontFamily: t.fontFamily || 'Arial',
    _N$overflow: 0,
    _N$cacheMode: 0,
    _id: '',
  };
}

function buildSpriteComponent(node: IrNode, nodeId: number, spriteFrameUuid: string): Record<string, unknown> {
  return {
    __type__: 'cc.Sprite',
    _name: '',
    _objFlags: 0,
    node: { __id__: nodeId },
    _enabled: true,
    _materials: [{ __uuid__: DEFAULT_SPRITE_MATERIAL_UUID }],
    _srcBlendFactor: 770,
    _dstBlendFactor: 771,
    _spriteFrame: spriteFrameUuid ? { __uuid__: spriteFrameUuid } : null,
    _type: node.kind === 'slicedSprite' ? 1 : 0,
    _sizeMode: CC2_SPRITE_SIZE_MODE_TRIMMED,
    _fillType: 0,
    _fillCenter: { __type__: 'cc.Vec2', x: 0, y: 0 },
    _fillStart: 0,
    _fillRange: 0,
    _isTrimmedMode: true,
    _atlas: null,
    _id: '',
  };
}

function makePrefabInfo(rootNodeId: number): Record<string, unknown> {
  return {
    __type__: 'cc.PrefabInfo',
    root: { __id__: rootNodeId },
    asset: { __id__: 0 },
    fileId: randomHex(22),
    sync: false,
  };
}

function makeRootNode(frame: IR['frames'][number]): Record<string, unknown> {
  return {
    __type__: 'cc.Node',
    _name: defaultFrameNameSanitize(frame.name),
    _objFlags: 0,
    _parent: null,
    _children: [],
    _active: true,
    _components: [],
    _prefab: null,
    _opacity: 255,
    _color: { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 },
    _contentSize: { __type__: 'cc.Size', width: frame.width, height: frame.height },
    _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 },
    _trs: { __type__: 'TypedArray', ctor: 'Float64Array', array: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1] },
    _eulerAngles: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
    _skewX: 0,
    _skewY: 0,
    _is3DNode: false,
    _groupIndex: 0,
    groupIndex: 0,
    _id: '',
  };
}

function makePrefabRoot(): Record<string, unknown> {
  return {
    __type__: 'cc.Prefab',
    _name: '',
    _objFlags: 0,
    _native: '',
    data: { __id__: 1 },
    optimizationPolicy: 0,
    asyncLoadAssets: false,
    readonly: false,
  };
}

function makeLabelSize(text: IrText): { width: number; height: number } {
  const content = text.characters || '';
  const width = Math.max(8, Number((content.length * text.fontSize * 0.68).toFixed(2)));
  const height = Math.max(text.fontSize * 1.2, text.placement.height);
  return { width, height };
}

function makeTextNodeFor2x(text: IrText): IrNode {
  const size = makeLabelSize(text);
  return {
    ...text,
    placement: {
      ...text.placement,
      width: size.width,
      height: size.height,
    },
    subMetas: {},
  } as unknown as IrNode;
}

function normalizeNodeFor2x(node: IrNode): IrNode {
  if (node.kind === 'text') {
    return makeTextNodeFor2x(node as IrText);
  }
  if (node.kind === 'container' || node.kind === 'mask') {
    return {
      ...node,
      children: node.children.map((c) => normalizeNodeFor2x(c)),
      subMetas: {},
    } as IrNode;
  }
  return node;
}

function toLocalPos(node: IrNode, parentWidth: number, parentHeight: number): { x: number; y: number } {
  const x = node.placement.x + node.placement.width / 2 - parentWidth / 2;
  const y = parentHeight / 2 - (node.placement.y + node.placement.height / 2);
  return { x, y };
}

class PrefabBuilder2x {
  private readonly items: unknown[] = [];

  add(obj: unknown): number {
    this.items.push(obj);
    return this.items.length - 1;
  }

  at<T extends Record<string, unknown>>(id: number): T {
    return this.items[id] as T;
  }

  json(): string {
    return JSON.stringify(this.items, null, 2);
  }
}

function createNode2x(
  b: PrefabBuilder2x,
  node: IrNode,
  rootNodeId: number,
  parentNodeId: number | null,
  parentWidth: number,
  parentHeight: number,
  spriteUuidByAssetRef: ReadonlyMap<string, string>,
  fontUuidByKey: ReadonlyMap<string, string>,
  warnings: ReportEntry[],
): number {
  const { x, y } = toLocalPos(node, parentWidth, parentHeight);
  const nodeId = b.add(buildNodeBase(node, parentNodeId, x, y));

  if (node.kind === 'sprite' || node.kind === 'slicedSprite') {
    const sprite = node as IrSprite;
    const spriteFrameUuid = spriteUuidByAssetRef.get(sprite.assetRef) ?? '';
    const compId = b.add(buildSpriteComponent(node, nodeId, spriteFrameUuid));
    (b.at(nodeId)._components as Array<{ __id__: number }>).push({ __id__: compId });
  } else if (node.kind === 'text') {
    const t = node as IrText;
    const resolved = resolveLabelFontUuid(t, fontUuidByKey);
    if (!resolved.fontUuid) {
      warnings.push({
        level: 'warning',
        message: `Label 字体未匹配，回退系统字体：${t.fontFamily}|${t.fontStyle}`,
        nodeId: t.id,
      });
    } else if (!resolved.exactMatched) {
      warnings.push({
        level: 'info',
        message: `Label 字体按 family 回退匹配：${t.fontFamily}|${t.fontStyle}`,
        nodeId: t.id,
      });
    }
    const labelId = b.add(buildLabelComponent(t, nodeId, resolved.fontUuid));
    (b.at(nodeId)._components as Array<{ __id__: number }>).push({ __id__: labelId });
  }

  if (node.kind === 'container' || node.kind === 'mask') {
    for (const child of node.children) {
      const childId = createNode2x(
        b,
        child,
        rootNodeId,
        nodeId,
        node.placement.width,
        node.placement.height,
        spriteUuidByAssetRef,
        fontUuidByKey,
        warnings,
      );
      (b.at(nodeId)._children as Array<{ __id__: number }>).push({ __id__: childId });
    }
  }

  const prefabInfoId = b.add(makePrefabInfo(rootNodeId));
  b.at(nodeId)._prefab = { __id__: prefabInfoId };

  return nodeId;
}

function buildPrefab2x(
  frame: IR['frames'][number],
  spriteUuidByAssetRef: ReadonlyMap<string, string>,
  fontUuidByKey: ReadonlyMap<string, string>,
  warnings: ReportEntry[],
): Uint8Array {
  const b = new PrefabBuilder2x();
  b.add(makePrefabRoot());
  const rootNodeId = b.add(makeRootNode(frame));

  for (const rawChild of frame.children) {
    const child = normalizeNodeFor2x(rawChild);
    const childId = createNode2x(
      b,
      child,
      rootNodeId,
      rootNodeId,
      frame.width,
      frame.height,
      spriteUuidByAssetRef,
      fontUuidByKey,
      warnings,
    );
    (b.at(rootNodeId)._children as Array<{ __id__: number }>).push({ __id__: childId });
  }
  const rootPrefabInfoId = b.add(makePrefabInfo(rootNodeId));
  b.at(rootNodeId)._prefab = { __id__: rootPrefabInfoId };
  return encodeUtf8(b.json());
}

export function generateCocos2Files(ir: IR, settings: Cocos2EmitterSettings): Cocos2GenerateResult {
  const root = validateAssetsRelativeRoot(settings.assetsRootRelative);
  const prefabsDir = validateAssetsRelativeRoot(settings.prefabsRelativeDir || 'prefabs');
  const texturesDir = validateAssetsRelativeRoot(settings.texturesRelativeDir || 'textures');
  const fontsDir = validateAssetsRelativeRoot(settings.fontsRelativeDir || 'fonts');
  const includePrefabs = settings.includePrefabs !== false;
  const includeTextures = settings.includeTextures !== false;
  const includeFonts = settings.includeFonts !== false;

  const out: OutputFile[] = [];
  const warnings: ReportEntry[] = [];
  const spriteUuidByAssetRef = new Map<string, string>();
  const fontUuidByKey = new Map<string, string>();

  if (includeTextures && settings.atlasLayout) {
    const textureByAssetRef = settings.textureByAssetRef ?? new Map();
    emitAtlasPageTexturesCocos2(settings, root, texturesDir, textureByAssetRef, spriteUuidByAssetRef, out);
  }
  if (includeTextures) {
    const textureByAssetRef = settings.textureByAssetRef ?? new Map();
    for (const [assetRef, tex] of textureByAssetRef) {
      if (assetRef.startsWith('atlas://')) {
        continue;
      }
      if (spriteUuidByAssetRef.has(assetRef)) {
        continue;
      }
      const fileName = safeFileName(assetRef);
      const texRel = joinPath(root, texturesDir, fileName);
      const textureUuid = newUuid();
      const spriteFrameUuid = newUuid();
      spriteUuidByAssetRef.set(assetRef, spriteFrameUuid);
      out.push({ path: texRel, data: tex.bytes });
      out.push({
        path: `${texRel}.meta`,
        data: encodeUtf8(makeTextureMeta(fileName, textureUuid, spriteFrameUuid, tex.width, tex.height)),
      });
    }
  }

  if (includeFonts) {
    const fontByKey = settings.fontByKey ?? new Map();
    for (const [fontKey, font] of fontByKey) {
      const fileName = safeFileName(font.fileName);
      const rel = joinPath(root, fontsDir, fileName);
      const fontUuid = newUuid();
      fontUuidByKey.set(fontKey, fontUuid);
      out.push({ path: rel, data: font.bytes });
      out.push({ path: `${rel}.meta`, data: encodeUtf8(makeFontMeta(fontUuid)) });
    }
  }

  if (includePrefabs) {
    for (const frame of ir.frames) {
      const prefabName = `${(settings.frameNameSanitize ?? defaultFrameNameSanitize)(frame.name)}.prefab`;
      const prefabRel = joinPath(root, prefabsDir, prefabName);
      out.push({ path: prefabRel, data: buildPrefab2x(frame, spriteUuidByAssetRef, fontUuidByKey, warnings) });
      out.push({ path: `${prefabRel}.meta`, data: encodeUtf8(makePrefabMeta(newUuid())) });
    }
  }

  return { files: out, warnings };
}

