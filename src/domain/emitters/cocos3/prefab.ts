import { validateAssetsRelativeRoot } from '../../../shared/pathValidation';
import { allocateCocosSpriteAtlasSubMetaId, plistStemForSpriteAtlasSubMetaName } from '../../../shared/cocosSubMetaId';
import type { IR, IrFrame, IrPlacement, IrSprite, IrSlicedSprite, IrNode, IrText } from '../../ir/schema';
import type { AtlasLayout, AtlasSpriteEntry } from '../../atlas/atlasLayout';
import {
  allocatePlistFrameName,
  buildTexturePackerPlistFormat2Xml,
} from '../../atlas/texturePackerPlist';
import { encodeUtf8 } from '../../../shared/utf8';
import { makeImageImporterMeta, makeMetaFile, newUuid } from './meta';
import type { OutputFile } from '../../../shared/types';
import { fullScreenRootWidgetConfig, type WidgetConfig } from './widgetAdapter';

export type TextureBytesPayload = {
  bytes: Uint8Array;
  width: number;
  height: number;
};

export type FontBytesPayload = {
  fileName: string;
  bytes: Uint8Array;
};

/** Creator 3.8 工程内资源根相对路径（已校验，仅含安全段）。 */
export type Cocos3EmitterSettings = {
  assetsRootRelative: string;
  /** 相对 `assetsRootRelative` 的预制体目录，默认 `prefabs`。 */
  prefabsRelativeDir?: string;
  /** 相对 `assetsRootRelative` 的贴图目录，默认 `textures`。 */
  texturesRelativeDir?: string;
  /** 相对 `assetsRootRelative` 的字体目录，默认 `fonts`。 */
  fontsRelativeDir?: string;
  frameNameSanitize?: (name: string) => string;
  /** 与 IR `sprite.assetRef` 对应；有字节则写出 `textures/` 下 PNG 及 meta，并在 Prefab 中挂 SpriteFrame。 */
  textureByAssetRef?: ReadonlyMap<string, TextureBytesPayload>;
  /** key = `Family|Style`，value = TTF 文件名与字节。 */
  fontByKey?: ReadonlyMap<string, FontBytesPayload>;
  /** key = `Family|Style`，value = 用户手填的字体 uuid。 */
  fontUuidOverrideByKey?: ReadonlyMap<string, string>;
  includePrefabs?: boolean;
  includeTextures?: boolean;
  includeFonts?: boolean;
  /** 目标引擎版本；用于选择兼容的 `.meta` 版本号。 */
  engineVersion?: string;
  /** canonical `assetRef` → `primaryGroup`（贴图分组侧车与可选子目录）。 */
  primaryGroupByAssetRef?: ReadonlyMap<string, string> | Record<string, string>;
  /** 是否按 primary 组写入 textures 子目录。 */
  textureSubdirByPrimaryGroup?: boolean;
  /** 合图布局；与 `textureByAssetRef` 中 `atlas://${atlasKey}.png` 键配合（见 {@link atlasTextureMapKey}）。 */
  atlasLayout?: AtlasLayout;
  /**
   * 为 true 时在每张预制体的根节点附加 `cc.Widget`，四边对齐且 left/right/top/bottom 均为 0（铺满父节点）。
   * 仅应在勾选「导出 Widget」时由管线设为 true。
   */
  widgetRootFillScreen?: boolean;
};

const UI_LAYER = 33554432;

/** `Sprite.SizeMode.RAW`（CUSTOM=0, TRIMMED=1, RAW=2）：按 SpriteFrame 原始尺寸渲染，与 UITransform 使用贴图/sourceSize 一致。 */
const CC_SPRITE_SIZE_MODE_RAW = 2;

/** 与 `packAtlases` 中 `atlasTextureKey` 一致。 */
export function atlasTextureMapKey(atlasKey: string): string {
  return `atlas://${atlasKey}.png`;
}

type Cocos38AtlasMetaProfile = {
  imageVer: string;
  textureSubMetaVer: string;
  spriteFrameSubMetaVer: string;
};

function cocos38AtlasMetaProfile(engineVersion?: string): Cocos38AtlasMetaProfile {
  if (engineVersion?.startsWith('3.8')) {
    return { imageVer: '1.0.26', textureSubMetaVer: '1.0.22', spriteFrameSubMetaVer: '1.0.12' };
  }
  return { imageVer: '1.0.26', textureSubMetaVer: '1.0.22', spriteFrameSubMetaVer: '1.0.12' };
}

/**
 * 与 {@link makeImageImporterMeta} 一致：像素 UV 为左上角原点、y 向下；nuv 为 Creator 存盘用的归一化坐标。
 */
function spriteFrameVerticesForRect(
  rect: { x: number; y: number; width: number; height: number },
  pageW: number,
  pageH: number,
) {
  const { x: fullX, y: fullY, width: fullW, height: fullH } = rect;
  const rx = fullX;
  const ry = fullY;
  const rw = fullW;
  const rh = fullH;
  const hw = fullW / 2;
  const hh = fullH / 2;
  const W = pageW;
  const H = pageH;
  const u0 = rx;
  const v0 = ry + rh;
  const u1 = rx + rw;
  const v1 = ry + rh;
  const u2 = rx;
  const v2 = ry;
  const u3 = rx + rw;
  const v3 = ry;
  return {
    rawPosition: [-hw, -hh, 0, hw, -hh, 0, -hw, hh, 0, hw, hh, 0],
    indexes: [0, 1, 2, 2, 1, 3],
    uv: [u0, v0, u1, v1, u2, v2, u3, v3],
    nuv: [
      u0 / W,
      1 - v0 / H,
      u1 / W,
      1 - v1 / H,
      u2 / W,
      1 - v2 / H,
      u3 / W,
      1 - v3 / H,
    ],
    minPos: [-hw, -hh, 0],
    maxPos: [hw, hh, 0],
  };
}

/** 合图 PNG：仅保留 `texture` 子资源（6c48a），子图由同目录 `*.plist` + `sprite-atlas` meta 承载（与 Creator 工程惯例一致）。 */
function makeAtlasPageImageTextureOnlyMeta(params: {
  textureUuid: string;
  fileName: string;
  engineVersion?: string;
}): string {
  const { textureUuid, fileName, engineVersion } = params;
  const profile = cocos38AtlasMetaProfile(engineVersion);
  const texSubId = '6c48a';
  const displayNameBase = fileName.replace(/\.[^.]+$/, '') || 'atlas';
  const obj = {
    ver: profile.imageVer,
    importer: 'image',
    imported: true,
    uuid: textureUuid,
    files: ['.json', fileName],
    subMetas: {
      [texSubId]: {
        importer: 'texture',
        uuid: `${textureUuid}@${texSubId}`,
        displayName: displayNameBase,
        id: texSubId,
        name: 'texture',
        userData: {
          wrapModeS: 'clamp-to-edge',
          wrapModeT: 'clamp-to-edge',
          imageUuidOrDatabaseUri: textureUuid,
          isUuid: true,
          visible: false,
          minfilter: 'linear',
          magfilter: 'linear',
          mipfilter: 'none',
          anisotropy: 0,
        },
        ver: profile.textureSubMetaVer,
        imported: true,
        files: ['.json'],
        subMetas: {},
      },
    },
    userData: {
      hasAlpha: true,
      fixAlphaTransparencyArtifacts: true,
    },
  };
  return `${JSON.stringify(obj, null, 2)}\n`;
}

/**
 * Creator 3.x `sprite-atlas`：`*.plist.meta`，子图为 `sprite-frame`，`atlasUuid` 指向本 plist 根 uuid。
 * 预制体应引用 `atlasPlistUuid@subMetaId`，而非 PNG 上的子 sprite-frame。
 */
function makeSpriteAtlasPlistImporterMeta(params: {
  atlasPlistUuid: string;
  textureUuid: string;
  pngFileName: string;
  pageWidth: number;
  pageHeight: number;
  sprites: Array<{ entry: AtlasSpriteEntry; subMetaId: string; plistFrameName: string }>;
  engineVersion?: string;
}): string {
  const { atlasPlistUuid, textureUuid, pngFileName, pageWidth, pageHeight, sprites, engineVersion } = params;
  const profile = cocos38AtlasMetaProfile(engineVersion);
  const texSubId = '6c48a';
  const imageUri = `${textureUuid}@${texSubId}`;
  const subMetas: Record<string, unknown> = {};

  for (const s of sprites) {
    const { entry, subMetaId, plistFrameName } = s;
    const { rect, sourceSize } = entry;
    const rw = Math.round(rect.width);
    const rh = Math.round(rect.height);
    const rx = Math.round(rect.x);
    const ry = Math.round(rect.y);
    const vertices = spriteFrameVerticesForRect(rect, pageWidth, pageHeight);
    const spriteUuid = `${atlasPlistUuid}@${subMetaId}`;
    if (spriteUuid.lastIndexOf('@') !== atlasPlistUuid.length) {
      throw new Error('sprite-atlas: atlasPlistUuid must not contain "@"');
    }
    if (spriteUuid.slice(atlasPlistUuid.length + 1) !== subMetaId) {
      throw new Error('sprite-atlas: uuid suffix must equal subMetaId');
    }
    subMetas[subMetaId] = {
      importer: 'sprite-frame',
      uuid: spriteUuid,
      displayName: '',
      id: subMetaId,
      /** 与 Creator 导入一致：plist 帧键去扩展名（如 `a.png` → `a`），且与 `nameToSubId` 种子一致 */
      name: plistStemForSpriteAtlasSubMetaName(plistFrameName),
      userData: {
        trimThreshold: 1,
        rotated: false,
        offsetX: 0,
        offsetY: 0,
        trimX: rx,
        trimY: ry,
        width: rw,
        height: rh,
        rawWidth: Math.round(sourceSize.width),
        rawHeight: Math.round(sourceSize.height),
        borderTop: 0,
        borderBottom: 0,
        borderLeft: 0,
        borderRight: 0,
        packable: true,
        pixelsToUnit: 100,
        pivotX: 0.5,
        pivotY: 0.5,
        meshType: 0,
        vertices,
        isUuid: true,
        imageUuidOrDatabaseUri: imageUri,
        atlasUuid: atlasPlistUuid,
        trimType: 'auto',
      },
      ver: profile.spriteFrameSubMetaVer,
      imported: true,
      files: ['.json'],
      subMetas: {},
    };
  }

  const obj = {
    ver: '1.0.8',
    importer: 'sprite-atlas',
    imported: true,
    uuid: atlasPlistUuid,
    files: ['.json'],
    subMetas,
    userData: {
      atlasTextureName: pngFileName,
      format: 2,
      uuid: atlasPlistUuid,
      textureUuid: imageUri,
    },
  };
  return `${JSON.stringify(obj, null, 2)}\n`;
}

function emitAtlasPageTextures(
  settings: Cocos3EmitterSettings,
  root: string,
  texturesDir: string,
  texMap: ReadonlyMap<string, TextureBytesPayload>,
  spriteUuidByAssetRef: Map<string, string>,
  spriteAtlasPlistUuidByAssetRef: Map<string, string>,
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
    const atlasPlistUuid = newUuid();
    const orderedSprites = [...page.sprites].sort((a, b) =>
      a.assetRef < b.assetRef ? -1 : a.assetRef > b.assetRef ? 1 : 0,
    );
    const usedPlistNames = new Set<string>();
    const plistFrameNameByRef = new Map<string, string>();
    for (const entry of orderedSprites) {
      plistFrameNameByRef.set(entry.assetRef, allocatePlistFrameName(entry.assetRef, usedPlistNames));
    }
    const usedSubIds = new Set<string>(['6c48a', 'f9941']);
    const spriteBindings: Array<{ entry: AtlasSpriteEntry; subMetaId: string; plistFrameName: string }> = [];
    for (const entry of orderedSprites) {
      const plistFrameName = plistFrameNameByRef.get(entry.assetRef)!;
      const stem = plistStemForSpriteAtlasSubMetaName(plistFrameName);
      const subMetaId = allocateCocosSpriteAtlasSubMetaId(stem, usedSubIds);
      spriteBindings.push({ entry, subMetaId, plistFrameName });
      spriteUuidByAssetRef.set(entry.assetRef, `${atlasPlistUuid}@${subMetaId}`);
      spriteAtlasPlistUuidByAssetRef.set(entry.assetRef, atlasPlistUuid);
    }

    out.push({ path: texRel, data: payload.bytes });
    out.push({
      path: `${texRel}.meta`,
      data: utf8Bytes(
        makeAtlasPageImageTextureOnlyMeta({
          textureUuid,
          fileName,
          engineVersion: settings.engineVersion,
        }),
      ),
    });
    const plistFrames = spriteBindings.map((b) => ({
      frameName: b.plistFrameName,
      entry: b.entry,
    }));
    const plistPath = fileName.toLowerCase().endsWith('.png')
      ? `${texRel.slice(0, -4)}.plist`
      : `${texRel}.plist`;
    out.push({
      path: plistPath,
      data: utf8Bytes(
        buildTexturePackerPlistFormat2Xml({
          textureFileName: fileName,
          textureWidth: page.width,
          textureHeight: page.height,
          frames: plistFrames,
        }),
      ),
    });
    out.push({
      path: `${plistPath}.meta`,
      data: utf8Bytes(
        makeSpriteAtlasPlistImporterMeta({
          atlasPlistUuid,
          textureUuid,
          pngFileName: fileName,
          pageWidth: page.width,
          pageHeight: page.height,
          sprites: spriteBindings,
          engineVersion: settings.engineVersion,
        }),
      ),
    });
  }
}

function defaultFrameNameSanitize(name: string): string {
  const t = name.trim() || 'unnamed';
  return t.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 120);
}

function safeNodeName(name: string): string {
  const t = (name || 'node').trim().slice(0, 120);
  return t.replace(/[\r\n\u0000]/g, '_') || 'node';
}

function utf8Bytes(text: string): Uint8Array {
  return encodeUtf8(text);
}

function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join('/');
}

function measureBounds(roots: IrNode[]): { width: number; height: number } {
  let maxR = 0;
  let maxB = 0;
  const walk = (n: IrNode) => {
    maxR = Math.max(maxR, n.placement.x + n.placement.width);
    maxB = Math.max(maxB, n.placement.y + n.placement.height);
    if ('children' in n && n.children) {
      for (const c of n.children) {
        walk(c);
      }
    }
  };
  for (const r of roots) {
    walk(r);
  }
  const w = maxR > 0 ? maxR : 100;
  const h = maxB > 0 ? maxB : 100;
  return { width: w, height: h };
}

function lposForIrNode(n: IrNode, parentWidth: number, parentHeight: number): Record<string, unknown> {
  const cx = n.placement.x + n.placement.width / 2 - parentWidth / 2;
  const cy = parentHeight / 2 - (n.placement.y + n.placement.height / 2);
  return { __type__: 'cc.Vec3', x: cx, y: cy, z: 0 };
}

class PrefabArrayBuilder {
  private readonly items: unknown[] = [];
  private readonly usedFileIds = new Set<string>();

  newFileId(): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    for (;;) {
      let id = '';
      for (let i = 0; i < 22; i++) {
        id += alphabet[(Math.random() * alphabet.length) | 0]!;
      }
      if (!this.usedFileIds.has(id)) {
        this.usedFileIds.add(id);
        return id;
      }
    }
  }

  add(obj: unknown): number {
    this.items.push(obj);
    return this.items.length - 1;
  }

  get(): unknown[] {
    return this.items;
  }

  at<T extends Record<string, unknown>>(idx: number): T {
    return this.items[idx] as T;
  }
}

function defaultQuat(): Record<string, unknown> {
  return { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 };
}

function defaultVec3(x: number, y: number, z: number): Record<string, unknown> {
  return { __type__: 'cc.Vec3', x, y, z };
}

function emitUiTransform(b: PrefabArrayBuilder, nodeId: number, width: number, height: number): number {
  const uitId = b.add({
    __type__: 'cc.UITransform',
    _name: '',
    _objFlags: 0,
    __editorExtras__: {},
    node: { __id__: nodeId },
    _enabled: true,
    __prefab: { __id__: 0 },
    _contentSize: { __type__: 'cc.Size', width, height },
    _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 },
    _id: '',
  });
  const prefCompId = b.add({
    __type__: 'cc.CompPrefabInfo',
    fileId: b.newFileId(),
  });
  b.at(uitId).__prefab = { __id__: prefCompId };
  return uitId;
}

function emitSprite(
  b: PrefabArrayBuilder,
  nodeId: number,
  spriteFrameUuid: string | null,
  /** plist 图集根 uuid；散图 PNG 子 SpriteFrame 时为 null */
  spriteAtlasPlistUuid: string | null,
): number {
  const spriteId = b.add({
    __type__: 'cc.Sprite',
    _name: '',
    _objFlags: 0,
    __editorExtras__: {},
    node: { __id__: nodeId },
    _enabled: true,
    __prefab: { __id__: 0 },
    _customMaterial: null,
    _srcBlendFactor: 2,
    _dstBlendFactor: 4,
    _color: { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 },
    _spriteFrame: spriteFrameUuid
      ? { __uuid__: spriteFrameUuid, __expectedType__: 'cc.SpriteFrame' }
      : null,
    _type: 0,
    _fillType: 0,
    _sizeMode: CC_SPRITE_SIZE_MODE_RAW,
    _fillCenter: { __type__: 'cc.Vec2', x: 0, y: 0 },
    _fillStart: 0,
    _fillRange: 0,
    _isTrimmedMode: false,
    _useGrayscale: false,
    _atlas:
      spriteAtlasPlistUuid && spriteFrameUuid
        ? { __uuid__: spriteAtlasPlistUuid, __expectedType__: 'cc.SpriteAtlas' }
        : null,
    _id: '',
  });
  const prefCompId = b.add({
    __type__: 'cc.CompPrefabInfo',
    fileId: b.newFileId(),
  });
  b.at(spriteId).__prefab = { __id__: prefCompId };
  return spriteId;
}

function emitLabel(
  b: PrefabArrayBuilder,
  nodeId: number,
  n: IrText,
  fontUuidByKey: ReadonlyMap<string, string>,
): number {
  const key = `${n.fontFamily}|${n.fontStyle}`;
  const fontUuid = fontUuidByKey.get(key) ?? null;
  const fz = Math.max(1, Math.round(Number(n.fontSize)));
  const lineHeight = fz + 2;
  const outline = n.outline;
  const enableOutline = outline !== undefined && outline.width > 0;
  const outlineWidth = enableOutline ? Math.max(0, outline.width) : 0;
  const outlineColor = enableOutline
    ? outline!.color
    : { r: 0, g: 0, b: 0, a: 1 };
  const labelId = b.add({
    __type__: 'cc.Label',
    _name: '',
    _objFlags: 0,
    __editorExtras__: {},
    node: { __id__: nodeId },
    _enabled: true,
    __prefab: { __id__: 0 },
    _visFlags: 0,
    _customMaterial: null,
    _srcBlendFactor: 2,
    _dstBlendFactor: 4,
    _color: n.color
      ? {
          __type__: 'cc.Color',
          r: Math.round(n.color.r * 255),
          g: Math.round(n.color.g * 255),
          b: Math.round(n.color.b * 255),
          a: Math.round(n.color.a * 255),
        }
      : { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 },
    _string: n.characters,
    _horizontalAlign: 1,
    _verticalAlign: 1,
    _actualFontSize: fz,
    _fontSize: fz,
    _fontFamily: n.fontFamily || 'Arial',
    _lineHeight: lineHeight,
    _overflow: 0,
    _enableWrapText: true,
    _font: fontUuid ? { __uuid__: fontUuid } : null,
    _isSystemFontUsed: !fontUuid,
    _spacingX: 0,
    _isItalic: false,
    _isBold: false,
    _isUnderline: false,
    _underlineHeight: 2,
    _cacheMode: 0,
    _enableOutline: enableOutline,
    _outlineColor: {
      __type__: 'cc.Color',
      r: Math.round(outlineColor.r * 255),
      g: Math.round(outlineColor.g * 255),
      b: Math.round(outlineColor.b * 255),
      a: Math.round(outlineColor.a * 255),
    },
    _outlineWidth: outlineWidth,
    _id: '',
  });
  const prefCompId = b.add({
    __type__: 'cc.CompPrefabInfo',
    fileId: b.newFileId(),
  });
  b.at(labelId).__prefab = { __id__: prefCompId };
  return labelId;
}

type WidgetAlignFlags = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  hCenter: number;
  vCenter: number;
};

const WIDGET_ALIGN: WidgetAlignFlags = {
  top: 1,
  bottom: 4,
  left: 8,
  right: 32,
  hCenter: 16,
  vCenter: 2,
};

function readWidgetConfig(node: IrNode): WidgetConfig | null {
  const raw = (node.extensions as Record<string, unknown> | undefined)?.widget;
  if (!raw || typeof raw !== 'object') return null;
  const w = raw as Partial<WidgetConfig>;
  if (
    typeof w.isAlignLeft !== 'boolean' ||
    typeof w.isAlignRight !== 'boolean' ||
    typeof w.isAlignTop !== 'boolean' ||
    typeof w.isAlignBottom !== 'boolean' ||
    typeof w.isAlignHorizontalCenter !== 'boolean' ||
    typeof w.isAlignVerticalCenter !== 'boolean'
  ) {
    return null;
  }
  return {
    isAlignLeft: w.isAlignLeft,
    isAlignRight: w.isAlignRight,
    isAlignTop: w.isAlignTop,
    isAlignBottom: w.isAlignBottom,
    isAlignHorizontalCenter: w.isAlignHorizontalCenter,
    isAlignVerticalCenter: w.isAlignVerticalCenter,
    left: Number(w.left ?? 0),
    right: Number(w.right ?? 0),
    top: Number(w.top ?? 0),
    bottom: Number(w.bottom ?? 0),
    horizontalCenter: Number(w.horizontalCenter ?? 0),
    verticalCenter: Number(w.verticalCenter ?? 0),
  };
}

function emitWidget(b: PrefabArrayBuilder, nodeId: number, widget: WidgetConfig): number {
  let alignFlags = 0;
  if (widget.isAlignTop) alignFlags |= WIDGET_ALIGN.top;
  if (widget.isAlignBottom) alignFlags |= WIDGET_ALIGN.bottom;
  if (widget.isAlignLeft) alignFlags |= WIDGET_ALIGN.left;
  if (widget.isAlignRight) alignFlags |= WIDGET_ALIGN.right;
  if (widget.isAlignHorizontalCenter) alignFlags |= WIDGET_ALIGN.hCenter;
  if (widget.isAlignVerticalCenter) alignFlags |= WIDGET_ALIGN.vCenter;

  const widgetId = b.add({
    __type__: 'cc.Widget',
    _name: '',
    _objFlags: 0,
    __editorExtras__: {},
    node: { __id__: nodeId },
    _enabled: true,
    __prefab: { __id__: 0 },
    _alignFlags: alignFlags,
    _target: null,
    _left: widget.left,
    _right: widget.right,
    _top: widget.top,
    _bottom: widget.bottom,
    _horizontalCenter: widget.horizontalCenter,
    _verticalCenter: widget.verticalCenter,
    _id: '',
  });
  const prefCompId = b.add({
    __type__: 'cc.CompPrefabInfo',
    fileId: b.newFileId(),
  });
  b.at(widgetId).__prefab = { __id__: prefCompId };
  return widgetId;
}

function emitPrefabInfo(b: PrefabArrayBuilder, hierarchyRootId: number, prefabAssetId: number): number {
  return b.add({
    __type__: 'cc.PrefabInfo',
    root: { __id__: hierarchyRootId },
    asset: { __id__: prefabAssetId },
    fileId: b.newFileId(),
  });
}

/** 与 `Sprite.SizeMode.RAW` 及 SpriteFrame `rawWidth`/`rawHeight` 一致：散图用 PNG 尺寸，合图用 layout `sourceSize`。 */
function spriteRawContentSizeForEmit(
  assetRef: string,
  placement: IrPlacement,
  textureByAssetRef: ReadonlyMap<string, TextureBytesPayload>,
  atlasLayout: AtlasLayout | undefined,
): { width: number; height: number } {
  if (atlasLayout) {
    for (const page of atlasLayout.pages) {
      const entry = page.sprites.find((s) => s.assetRef === assetRef);
      if (entry) {
        return {
          width: Math.max(1, Math.round(entry.sourceSize.width)),
          height: Math.max(1, Math.round(entry.sourceSize.height)),
        };
      }
    }
  }
  const tex = textureByAssetRef.get(assetRef);
  if (tex) {
    return {
      width: Math.max(1, Math.round(tex.width)),
      height: Math.max(1, Math.round(tex.height)),
    };
  }
  return { width: placement.width, height: placement.height };
}

function emitIrNode(
  node: IrNode,
  parentId: number | null,
  parentSize: { width: number; height: number },
  hierarchyRootId: number,
  prefabAssetId: number,
  b: PrefabArrayBuilder,
  spriteUuidByAssetRef: ReadonlyMap<string, string>,
  spriteAtlasPlistUuidByAssetRef: ReadonlyMap<string, string>,
  fontUuidByKey: ReadonlyMap<string, string>,
  resolveSpriteRawContentSize: (assetRef: string, placement: IrPlacement) => { width: number; height: number },
): number {
  const nodeIdx = b.add({
    __type__: 'cc.Node',
    _name: safeNodeName(node.name),
    _objFlags: 0,
    __editorExtras__: {},
    _parent: parentId === null ? null : { __id__: parentId },
    _children: [] as { __id__: number }[],
    _active: true,
    _components: [] as { __id__: number }[],
    _prefab: { __id__: 0 },
    _lpos: lposForIrNode(node, parentSize.width, parentSize.height),
    _lrot: defaultQuat(),
    _lscale: defaultVec3(1, 1, 1),
    _mobility: 0,
    _layer: UI_LAYER,
    _euler: defaultVec3(0, 0, 0),
    _id: '',
  });

  const childIds: number[] = [];
  if (node.kind === 'container') {
    for (const ch of node.children) {
      childIds.push(
        emitIrNode(
          ch,
          nodeIdx,
          { width: node.placement.width, height: node.placement.height },
          hierarchyRootId,
          prefabAssetId,
          b,
          spriteUuidByAssetRef,
          spriteAtlasPlistUuidByAssetRef,
          fontUuidByKey,
          resolveSpriteRawContentSize,
        ),
      );
    }
  }
  b.at(nodeIdx)._children = childIds.map((id) => ({ __id__: id }));

  const compIds: number[] = [];
  const uitSize =
    node.kind === 'sprite'
      ? resolveSpriteRawContentSize((node as IrSprite).assetRef, node.placement)
      : { width: node.placement.width, height: node.placement.height };
  const uitId = emitUiTransform(b, nodeIdx, uitSize.width, uitSize.height);
  compIds.push(uitId);

  if (node.kind === 'sprite') {
    const assetRef = (node as IrSprite).assetRef;
    const sf = spriteUuidByAssetRef.get(assetRef) ?? null;
    const atlasUuid = spriteAtlasPlistUuidByAssetRef.get(assetRef) ?? null;
    compIds.push(emitSprite(b, nodeIdx, sf, atlasUuid));
  } else if (node.kind === 'text') {
    compIds.push(emitLabel(b, nodeIdx, node as IrText, fontUuidByKey));
  }
  const widgetCfg = readWidgetConfig(node);
  if (widgetCfg) {
    compIds.push(emitWidget(b, nodeIdx, widgetCfg));
  }

  b.at(nodeIdx)._components = compIds.map((id) => ({ __id__: id }));

  const pInfoId = emitPrefabInfo(b, hierarchyRootId, prefabAssetId);
  b.at(nodeIdx)._prefab = { __id__: pInfoId };
  return nodeIdx;
}

function buildPrefabJson(
  frame: IrFrame,
  displayName: string,
  spriteUuidByAssetRef: ReadonlyMap<string, string>,
  spriteAtlasPlistUuidByAssetRef: ReadonlyMap<string, string>,
  fontUuidByKey: ReadonlyMap<string, string>,
  textureByAssetRef: ReadonlyMap<string, TextureBytesPayload>,
  atlasLayout: AtlasLayout | undefined,
  attachRootFillWidget: boolean,
): string {
  const resolveSpriteRawContentSize = (assetRef: string, placement: IrPlacement) =>
    spriteRawContentSizeForEmit(assetRef, placement, textureByAssetRef, atlasLayout);
  const b = new PrefabArrayBuilder();
  const prefabAssetId = b.add({
    __type__: 'cc.Prefab',
    _name: displayName,
    _objFlags: 0,
    __editorExtras__: {},
    _native: '',
    data: { __id__: 1 },
    optimizationPolicy: 0,
    asyncLoadAssets: false,
    persistent: false,
  });

  const bounds = {
    width: frame.width > 0 ? frame.width : measureBounds(frame.children).width,
    height: frame.height > 0 ? frame.height : measureBounds(frame.children).height,
  };
  const hierarchyRootId = b.add({
    __type__: 'cc.Node',
    _name: safeNodeName(displayName),
    _objFlags: 0,
    __editorExtras__: {},
    _parent: null,
    _children: [] as { __id__: number }[],
    _active: true,
    _components: [] as { __id__: number }[],
    _prefab: { __id__: 0 },
    _lpos: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
    _lrot: defaultQuat(),
    _lscale: defaultVec3(1, 1, 1),
    _mobility: 0,
    _layer: UI_LAYER,
    _euler: defaultVec3(0, 0, 0),
    _id: '',
  });

  b.at(prefabAssetId).data = { __id__: hierarchyRootId };

  const childIds = frame.children.map((r) =>
    emitIrNode(
      r,
      hierarchyRootId,
      { width: bounds.width, height: bounds.height },
      hierarchyRootId,
      prefabAssetId,
      b,
      spriteUuidByAssetRef,
      spriteAtlasPlistUuidByAssetRef,
      fontUuidByKey,
      resolveSpriteRawContentSize,
    ),
  );
  b.at(hierarchyRootId)._children = childIds.map((id) => ({ __id__: id }));

  const rootUit = emitUiTransform(b, hierarchyRootId, bounds.width, bounds.height);
  const rootComponentIds: number[] = [rootUit];
  if (attachRootFillWidget) {
    rootComponentIds.push(emitWidget(b, hierarchyRootId, fullScreenRootWidgetConfig()));
  }
  b.at(hierarchyRootId)._components = rootComponentIds.map((id) => ({ __id__: id }));

  const rootPInfo = emitPrefabInfo(b, hierarchyRootId, prefabAssetId);
  b.at(hierarchyRootId)._prefab = { __id__: rootPInfo };

  return `${JSON.stringify(b.get(), null, 2)}\n`;
}

function walkIrNodes(roots: readonly IrNode[], visit: (n: IrNode) => void): void {
  const walk = (n: IrNode) => {
    visit(n);
    if ('children' in n && n.children) {
      for (const c of n.children) {
        walk(c);
      }
    }
  };
  for (const r of roots) {
    walk(r);
  }
}

function collectTextureLikeNodesInFrame(frame: IrFrame): Array<{ assetRef: string }> {
  const nodes: Array<{ assetRef: string }> = [];
  walkIrNodes(frame.children, (n) => {
    if (n.kind === 'sprite') {
      nodes.push({ assetRef: (n as IrSprite).assetRef });
    } else if (n.kind === 'slicedSprite') {
      nodes.push({ assetRef: (n as IrSlicedSprite).assetRef });
    }
  });
  return nodes;
}

function textureFileNameFromAssetRef(assetRef: string): string {
  const base = assetRef.trim().replace(/\\/g, '/').split('/').pop() ?? 'texture.png';
  return base.replace(/[<>:"|?*\u0000-\u001f]/g, '_') || 'texture.png';
}

function primaryGroupMapFromSettings(
  raw: ReadonlyMap<string, string> | Record<string, string> | undefined,
): Map<string, string> {
  if (!raw) return new Map();
  if (raw instanceof Map) return new Map(raw);
  return new Map(Object.entries(raw));
}

/**
 * 将分组名转为单个安全路径段；若结果为空或 `.` / `..` 则返回 `''`（调用方应回退为扁平 textures 目录）。
 * 非法字符集与 {@link textureFileNameFromAssetRef} 一致，并去掉 `/`、`\`。
 */
export function sanitizeTextureGroupPathSegment(segment: string): string {
  let s = segment.replace(/[/\\]/g, '');
  s = s.replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim();
  if (s === '' || s === '.' || s === '..') return '';
  return s;
}

/**
 * 将 IR 导出为 Creator 3.8 兼容的 JSON 数组 `.prefab` 及 `.meta`。
 */
export function generateCocos3Files(ir: IR, settings: Cocos3EmitterSettings): OutputFile[] {
  const root = validateAssetsRelativeRoot(settings.assetsRootRelative);
  const prefabsDir = validateAssetsRelativeRoot(
    settings.prefabsRelativeDir !== undefined && settings.prefabsRelativeDir.trim() !== ''
      ? settings.prefabsRelativeDir
      : 'prefabs',
  );
  const texturesDir = validateAssetsRelativeRoot(
    settings.texturesRelativeDir !== undefined && settings.texturesRelativeDir.trim() !== ''
      ? settings.texturesRelativeDir
      : 'textures',
  );
  const fontsDir = validateAssetsRelativeRoot(
    settings.fontsRelativeDir !== undefined && settings.fontsRelativeDir.trim() !== ''
      ? settings.fontsRelativeDir
      : 'fonts',
  );
  const sanitize = settings.frameNameSanitize ?? defaultFrameNameSanitize;
  const includePrefabs = settings.includePrefabs !== false;
  const includeTextures = settings.includeTextures !== false;
  const includeFonts = settings.includeFonts !== false;
  const out: OutputFile[] = [];
  const texMap = settings.textureByAssetRef ?? new Map<string, TextureBytesPayload>();
  const fontMap = settings.fontByKey ?? new Map<string, FontBytesPayload>();
  const fontUuidOverrideByKey = settings.fontUuidOverrideByKey ?? new Map<string, string>();
  const spriteUuidByAssetRef = new Map<string, string>();
  const spriteAtlasPlistUuidByAssetRef = new Map<string, string>();
  const fontUuidByKey = new Map<string, string>();
  const primaryGroupByAssetRef = primaryGroupMapFromSettings(settings.primaryGroupByAssetRef);

  for (const [fontKey, overrideUuid] of fontUuidOverrideByKey.entries()) {
    if (overrideUuid.trim() !== '') {
      fontUuidByKey.set(fontKey, overrideUuid.trim());
    }
  }

  if (includeFonts) {
    for (const [fontKey, payload] of fontMap.entries()) {
      const fileName = (payload.fileName || '').trim();
      if (fileName === '' || !fileName.toLowerCase().endsWith('.ttf')) {
        continue;
      }
      const fontUuid = fontUuidByKey.get(fontKey) ?? newUuid();
      const fontRel = joinPath(root, fontsDir, fileName);
      out.push({ path: fontRel, data: payload.bytes });
      out.push({
        path: `${fontRel}.meta`,
        data: utf8Bytes(
          makeMetaFile({
            uuid: fontUuid,
            kind: 'TTFFont',
            fileName,
            engineVersion: settings.engineVersion,
          }),
        ),
      });
      fontUuidByKey.set(fontKey, fontUuid);
    }
  }

  if (includeTextures && settings.atlasLayout) {
    emitAtlasPageTextures(
      settings,
      root,
      texturesDir,
      texMap,
      spriteUuidByAssetRef,
      spriteAtlasPlistUuidByAssetRef,
      out,
    );
  }
  if (includeTextures) {
    for (const frame of ir.frames) {
      for (const { assetRef } of collectTextureLikeNodesInFrame(frame)) {
        const payload = texMap.get(assetRef);
        if (!payload || spriteUuidByAssetRef.has(assetRef)) {
          continue;
        }
        const fileName = textureFileNameFromAssetRef(assetRef);
        const primary = primaryGroupByAssetRef.get(assetRef);
        const groupSeg =
          settings.textureSubdirByPrimaryGroup && primary && primary.trim() !== ''
            ? sanitizeTextureGroupPathSegment(primary)
            : '';
        const texRel = groupSeg
          ? joinPath(root, texturesDir, groupSeg, fileName)
          : joinPath(root, texturesDir, fileName);
        const textureUuid = newUuid();
        const spriteUuid = `${textureUuid}@f9941`;
        spriteUuidByAssetRef.set(assetRef, spriteUuid);
        out.push({ path: texRel, data: payload.bytes });
        out.push({
          path: `${texRel}.meta`,
          data: utf8Bytes(
            makeImageImporterMeta({
              textureUuid,
              spriteUuid,
              fileName,
              width: Math.round(payload.width),
              height: Math.round(payload.height),
              engineVersion: settings.engineVersion,
            }),
          ),
        });
      }
    }
  }

  if (includePrefabs) {
    for (const frame of ir.frames) {
      const displayName = sanitize(frame.name);
      const prefabRel = joinPath(root, prefabsDir, `${displayName}.prefab`);
      const prefabUuid = newUuid();
      const json = buildPrefabJson(
        frame,
        displayName,
        spriteUuidByAssetRef,
        spriteAtlasPlistUuidByAssetRef,
        fontUuidByKey,
        texMap,
        settings.atlasLayout,
        settings.widgetRootFillScreen === true,
      );
      out.push({ path: prefabRel, data: utf8Bytes(json) });
      out.push({
        path: `${prefabRel}.meta`,
        data: utf8Bytes(
          makeMetaFile({
            uuid: prefabUuid,
            kind: 'Prefab',
            syncNodeName: displayName,
            engineVersion: settings.engineVersion,
          }),
        ),
      });
    }
  }

  return out;
}
