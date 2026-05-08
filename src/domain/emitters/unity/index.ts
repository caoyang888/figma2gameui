import { validateAssetsRelativeRoot } from '../../../shared/pathValidation';
import { encodeUtf8 } from '../../../shared/utf8';
import type { OutputFile } from '../../../shared/types';
import type { AtlasLayout, AtlasPage } from '../../atlas/atlasLayout';
import type { IR, IrContainer, IrMask, IrNode, IrSprite, IrText } from '../../ir/schema';
import type { Emitter, EmitInput, EmitOutput, EmitterDescriptor } from '../types';

type TextureBytesPayload = {
  bytes: Uint8Array;
  width: number;
  height: number;
};

type FontBytesPayload = {
  fileName: string;
  bytes: Uint8Array;
};

export type UnityEmitterSettings = {
  assetsRootRelative: string;
  prefabsRelativeDir?: string;
  texturesRelativeDir?: string;
  fontsRelativeDir?: string;
  textureByAssetRef?: ReadonlyMap<string, TextureBytesPayload>;
  fontByKey?: ReadonlyMap<string, FontBytesPayload>;
  /** 存在时走合图导出：按页写入一张 PNG 与 `.spriteatlas` 资产，prefab 仍引用散图 Sprite。 */
  atlasLayout?: AtlasLayout;
  includePrefabs?: boolean;
  includeTextures?: boolean;
  includeFonts?: boolean;
};

type UnityVersionProfile = '2019.4.x' | '2020.1.x' | '2021.1.x' | '2022.1.x';
const UNITY_UI_IMAGE_SCRIPT_GUID = 'fe87c0e1cc204ed48ad3b37840f39efc';
// Unity 2019.4 project sample Text component script guid
const UNITY_UI_TEXT_SCRIPT_GUID = '5f7201a12d95ffc409449d95f23cf332';
const UNITY_DEFAULT_FONT_GUID = '0000000000000000e000000000000000';

function normalizeUnityVersionProfile(version: string): UnityVersionProfile {
  if (version.startsWith('2019.4')) return '2019.4.x';
  if (version.startsWith('2020')) return '2020.1.x';
  if (version.startsWith('2021')) return '2021.1.x';
  return '2022.1.x';
}

function safeName(name: string): string {
  const trimmed = (name || 'unnamed').trim();
  const replaced = trimmed.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  return replaced.slice(0, 120) || 'unnamed';
}

function baseName(pathLike: string): string {
  const parts = pathLike.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? pathLike;
}

function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join('/');
}

function encodeJson(value: unknown): Uint8Array {
  return encodeUtf8(JSON.stringify(value, null, 2));
}

function decodeBytes(bytes: Uint8Array): string {
  const DecoderCtor = (globalThis as { TextDecoder?: typeof TextDecoder }).TextDecoder;
  if (typeof DecoderCtor === 'function') {
    return new DecoderCtor().decode(bytes);
  }
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]!);
  }
  try {
    return decodeURIComponent(escape(s));
  } catch {
    return s;
  }
}

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

function newUnityGuid(): string {
  return randomHex(32);
}

function toUnityY(yTop: number, h: number, parentH: number): number {
  return parentH / 2 - (yTop + h / 2);
}

type FlatNode = {
  id: string;
  name: string;
  kind: IrNode['kind'];
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  visible: boolean;
  text?: { value: string; fontSize: number; fontFamily: string; fontStyle: string };
  constraints?: {
    horizontal?: 'min' | 'max' | 'center' | 'stretch' | 'scale';
    vertical?: 'min' | 'max' | 'center' | 'stretch' | 'scale';
    widgetNumbers?: {
      left: number;
      right: number;
      top: number;
      bottom: number;
      horizontalCenter: number;
      verticalCenter: number;
    };
  };
  assetRef?: string;
  children: FlatNode[];
};

function flattenNode(node: IrNode): FlatNode {
  const base: FlatNode = {
    id: node.id,
    name: safeName(node.name),
    kind: node.kind,
    x: node.placement.x,
    y: node.placement.y,
    width: node.placement.width,
    height: node.placement.height,
    opacity: node.opacity,
    visible: node.visible,
    constraints:
      node.extensions && typeof node.extensions === 'object'
        ? ((node.extensions as Record<string, unknown>).constraints as FlatNode['constraints'] | undefined)
        : undefined,
    children: [],
  };
  if (node.kind === 'container' || node.kind === 'mask') {
    base.children = node.children.map((child) => flattenNode(child));
    return base;
  }
  if (node.kind === 'sprite' || node.kind === 'slicedSprite') {
    const spriteNode = node as IrSprite;
    base.assetRef = spriteNode.assetRef;
    return base;
  }
  const textNode = node as IrText;
  base.text = {
    value: textNode.characters,
    fontSize: textNode.fontSize,
    fontFamily: textNode.fontFamily,
    fontStyle: textNode.fontStyle,
  };
  return base;
}

type RectLayout = {
  anchorMinX: number;
  anchorMinY: number;
  anchorMaxX: number;
  anchorMaxY: number;
  anchoredX: number;
  anchoredY: number;
  sizeDeltaX: number;
  sizeDeltaY: number;
};

function computeRectLayout(node: FlatNode, parentWidth: number, parentHeight: number): RectLayout {
  const fallback: RectLayout = {
    anchorMinX: 0.5,
    anchorMinY: 0.5,
    anchorMaxX: 0.5,
    anchorMaxY: 0.5,
    anchoredX: node.x + node.width / 2 - parentWidth / 2,
    anchoredY: toUnityY(node.y, node.height, parentHeight),
    sizeDeltaX: node.width,
    sizeDeltaY: node.height,
  };
  const c = node.constraints;
  const snap = c?.widgetNumbers;
  if (!c || !snap) return fallback;

  const out: RectLayout = { ...fallback };
  switch (c.horizontal) {
    case 'min':
      out.anchorMinX = 0;
      out.anchorMaxX = 0;
      out.anchoredX = snap.left + node.width / 2;
      out.sizeDeltaX = node.width;
      break;
    case 'max':
      out.anchorMinX = 1;
      out.anchorMaxX = 1;
      out.anchoredX = -(snap.right + node.width / 2);
      out.sizeDeltaX = node.width;
      break;
    case 'stretch':
      out.anchorMinX = 0;
      out.anchorMaxX = 1;
      out.anchoredX = (snap.left - snap.right) / 2;
      out.sizeDeltaX = -(snap.left + snap.right);
      break;
    case 'center':
    case 'scale':
      out.anchorMinX = 0.5;
      out.anchorMaxX = 0.5;
      out.anchoredX = snap.horizontalCenter;
      out.sizeDeltaX = node.width;
      break;
  }

  switch (c.vertical) {
    case 'min':
      out.anchorMinY = 1;
      out.anchorMaxY = 1;
      out.anchoredY = -(snap.top + node.height / 2);
      out.sizeDeltaY = node.height;
      break;
    case 'max':
      out.anchorMinY = 0;
      out.anchorMaxY = 0;
      out.anchoredY = snap.bottom + node.height / 2;
      out.sizeDeltaY = node.height;
      break;
    case 'stretch':
      out.anchorMinY = 0;
      out.anchorMaxY = 1;
      out.anchoredY = (snap.bottom - snap.top) / 2;
      out.sizeDeltaY = -(snap.top + snap.bottom);
      break;
    case 'center':
    case 'scale':
      out.anchorMinY = 0.5;
      out.anchorMaxY = 0.5;
      out.anchoredY = snap.verticalCenter;
      out.sizeDeltaY = node.height;
      break;
  }
  return out;
}

type UnityNodeIds = {
  gameObjectId: number;
  transformId: number;
};

type UnityPrefabContext = {
  lines: string[];
  nextFileId: number;
  textureGuidByAssetRef: Map<string, string>;
  rootHeight: number;
  nodeIdsById: Map<string, UnityNodeIds>;
  childOrderById: Map<string, string[]>;
};

function allocFileId(ctx: UnityPrefabContext): number {
  const id = ctx.nextFileId;
  ctx.nextFileId += 2;
  return id;
}

function emitGameObject(ctx: UnityPrefabContext, fileId: number, name: string, componentIds: number[], active: boolean): void {
  ctx.lines.push(`--- !u!1 &${fileId}`);
  ctx.lines.push('GameObject:');
  ctx.lines.push('  m_ObjectHideFlags: 0');
  ctx.lines.push('  m_CorrespondingSourceObject: {fileID: 0}');
  ctx.lines.push('  m_PrefabInstance: {fileID: 0}');
  ctx.lines.push('  m_PrefabAsset: {fileID: 0}');
  ctx.lines.push('  serializedVersion: 6');
  ctx.lines.push('  m_Component:');
  for (const cid of componentIds) {
    ctx.lines.push(`  - component: {fileID: ${cid}}`);
  }
  ctx.lines.push('  m_Layer: 5');
  ctx.lines.push(`  m_Name: ${name}`);
  ctx.lines.push('  m_TagString: Untagged');
  ctx.lines.push('  m_Icon: {fileID: 0}');
  ctx.lines.push('  m_NavMeshLayer: 0');
  ctx.lines.push('  m_StaticEditorFlags: 0');
  ctx.lines.push(`  m_IsActive: ${active ? 1 : 0}`);
}

function emitRectTransform(
  ctx: UnityPrefabContext,
  transformId: number,
  gameObjectId: number,
  parentTransformId: number | 0,
  layout: RectLayout,
  children: number[],
): void {
  ctx.lines.push(`--- !u!224 &${transformId}`);
  ctx.lines.push('RectTransform:');
  ctx.lines.push('  m_ObjectHideFlags: 0');
  ctx.lines.push('  m_CorrespondingSourceObject: {fileID: 0}');
  ctx.lines.push('  m_PrefabInstance: {fileID: 0}');
  ctx.lines.push('  m_PrefabAsset: {fileID: 0}');
  ctx.lines.push(`  m_GameObject: {fileID: ${gameObjectId}}`);
  ctx.lines.push('  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}');
  ctx.lines.push('  m_LocalPosition: {x: 0, y: 0, z: 0}');
  ctx.lines.push('  m_LocalScale: {x: 1, y: 1, z: 1}');
  ctx.lines.push('  m_ConstrainProportionsScale: 0');
  ctx.lines.push(`  m_Children:${children.length === 0 ? ' []' : ''}`);
  for (const childId of children) {
    ctx.lines.push(`  - {fileID: ${childId}}`);
  }
  ctx.lines.push(`  m_Father: {fileID: ${parentTransformId}}`);
  ctx.lines.push('  m_RootOrder: 0');
  ctx.lines.push('  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}');
  ctx.lines.push(`  m_AnchorMin: {x: ${layout.anchorMinX.toFixed(3)}, y: ${layout.anchorMinY.toFixed(3)}}`);
  ctx.lines.push(`  m_AnchorMax: {x: ${layout.anchorMaxX.toFixed(3)}, y: ${layout.anchorMaxY.toFixed(3)}}`);
  ctx.lines.push(`  m_AnchoredPosition: {x: ${layout.anchoredX.toFixed(3)}, y: ${layout.anchoredY.toFixed(3)}}`);
  ctx.lines.push(
    `  m_SizeDelta: {x: ${Math.max(0, layout.sizeDeltaX).toFixed(3)}, y: ${Math.max(0, layout.sizeDeltaY).toFixed(3)}}`,
  );
  ctx.lines.push('  m_Pivot: {x: 0.5, y: 0.5}');
}

function emitCanvasRenderer(ctx: UnityPrefabContext, rendererId: number, gameObjectId: number): void {
  ctx.lines.push(`--- !u!222 &${rendererId}`);
  ctx.lines.push('CanvasRenderer:');
  ctx.lines.push('  m_ObjectHideFlags: 0');
  ctx.lines.push('  m_CorrespondingSourceObject: {fileID: 0}');
  ctx.lines.push('  m_PrefabInstance: {fileID: 0}');
  ctx.lines.push('  m_PrefabAsset: {fileID: 0}');
  ctx.lines.push(`  m_GameObject: {fileID: ${gameObjectId}}`);
  ctx.lines.push('  m_CullTransparentMesh: 0');
}

function escapeYamlSingleLine(text: string): string {
  return text.replace(/\r/g, '').replace(/\n/g, '\\n');
}

function emitUIText(
  ctx: UnityPrefabContext,
  textId: number,
  gameObjectId: number,
  textNode: NonNullable<FlatNode['text']>,
  fontGuid?: string,
): void {
  ctx.lines.push(`--- !u!114 &${textId}`);
  ctx.lines.push('MonoBehaviour:');
  ctx.lines.push('  m_ObjectHideFlags: 0');
  ctx.lines.push('  m_CorrespondingSourceObject: {fileID: 0}');
  ctx.lines.push('  m_PrefabInstance: {fileID: 0}');
  ctx.lines.push('  m_PrefabAsset: {fileID: 0}');
  ctx.lines.push(`  m_GameObject: {fileID: ${gameObjectId}}`);
  ctx.lines.push('  m_Enabled: 1');
  ctx.lines.push('  m_EditorHideFlags: 0');
  ctx.lines.push(`  m_Script: {fileID: 11500000, guid: ${UNITY_UI_TEXT_SCRIPT_GUID}, type: 3}`);
  ctx.lines.push('  m_Name: ');
  ctx.lines.push('  m_EditorClassIdentifier: ');
  ctx.lines.push('  m_Material: {fileID: 0}');
  ctx.lines.push('  m_Color: {r: 1, g: 1, b: 1, a: 1}');
  ctx.lines.push('  m_RaycastTarget: 1');
  ctx.lines.push('  m_RaycastPadding: {x: 0, y: 0, z: 0, w: 0}');
  ctx.lines.push('  m_Maskable: 1');
  ctx.lines.push('  m_OnCullStateChanged:');
  ctx.lines.push('    m_PersistentCalls:');
  ctx.lines.push('      m_Calls: []');
  ctx.lines.push(`  m_Text: ${escapeYamlSingleLine(textNode.value)}`);
  ctx.lines.push(`  m_isRightToLeft: 0`);
  ctx.lines.push(`  m_FontData:`);
  if (fontGuid) {
    ctx.lines.push(`    m_Font: {fileID: 12800000, guid: ${fontGuid}, type: 3}`);
  } else {
    ctx.lines.push(`    m_Font: {fileID: 12800000, guid: ${UNITY_DEFAULT_FONT_GUID}, type: 0}`);
  }
  ctx.lines.push(`    m_FontSize: ${Math.max(1, Math.round(textNode.fontSize))}`);
  ctx.lines.push('    m_FontStyle: 0');
  ctx.lines.push('    m_BestFit: 0');
  ctx.lines.push('    m_MinSize: 8');
  ctx.lines.push(`    m_MaxSize: ${Math.max(16, Math.round(textNode.fontSize * 1.25))}`);
  ctx.lines.push('    m_Alignment: 4');
  ctx.lines.push('    m_AlignByGeometry: 0');
  ctx.lines.push('    m_RichText: 1');
  ctx.lines.push('    m_HorizontalOverflow: 1');
  ctx.lines.push('    m_VerticalOverflow: 1');
  ctx.lines.push('    m_LineSpacing: 1');
}

function emitUIImage(
  ctx: UnityPrefabContext,
  imageId: number,
  gameObjectId: number,
  assetRef: string | undefined,
  opacity: number,
): void {
  const texGuid = assetRef ? ctx.textureGuidByAssetRef.get(assetRef) : undefined;
  const alpha = Math.max(0, Math.min(1, opacity));
  ctx.lines.push(`--- !u!114 &${imageId}`);
  ctx.lines.push('MonoBehaviour:');
  ctx.lines.push('  m_ObjectHideFlags: 0');
  ctx.lines.push('  m_CorrespondingSourceObject: {fileID: 0}');
  ctx.lines.push('  m_PrefabInstance: {fileID: 0}');
  ctx.lines.push('  m_PrefabAsset: {fileID: 0}');
  ctx.lines.push(`  m_GameObject: {fileID: ${gameObjectId}}`);
  ctx.lines.push(`  m_Enabled: ${opacity > 0 ? 1 : 0}`);
  ctx.lines.push('  m_EditorHideFlags: 0');
  ctx.lines.push(`  m_Script: {fileID: 11500000, guid: ${UNITY_UI_IMAGE_SCRIPT_GUID}, type: 3}`);
  ctx.lines.push('  m_Name: ');
  ctx.lines.push('  m_EditorClassIdentifier: UnityEngine.UI::UnityEngine.UI.Image');
  ctx.lines.push('  m_Material: {fileID: 0}');
  ctx.lines.push(`  m_Color: {r: 1, g: 1, b: 1, a: ${alpha.toFixed(3)}}`);
  ctx.lines.push('  m_RaycastTarget: 1');
  ctx.lines.push('  m_RaycastPadding: {x: 0, y: 0, z: 0, w: 0}');
  ctx.lines.push('  m_Maskable: 1');
  ctx.lines.push('  m_OnCullStateChanged:');
  ctx.lines.push('    m_PersistentCalls:');
  ctx.lines.push('      m_Calls: []');
  if (texGuid) {
    ctx.lines.push(`  m_Sprite: {fileID: 21300000, guid: ${texGuid}, type: 3}`);
  } else {
    ctx.lines.push('  m_Sprite: {fileID: 0}');
  }
  ctx.lines.push('  m_Type: 0');
  ctx.lines.push('  m_PreserveAspect: 0');
  ctx.lines.push('  m_FillCenter: 1');
  ctx.lines.push('  m_FillMethod: 4');
  ctx.lines.push('  m_FillAmount: 1');
  ctx.lines.push('  m_FillClockwise: 1');
  ctx.lines.push('  m_FillOrigin: 0');
  ctx.lines.push('  m_UseSpriteMesh: 0');
  ctx.lines.push('  m_PixelsPerUnitMultiplier: 1');
}

function collectChildOrder(node: FlatNode, childOrderById: Map<string, string[]>): void {
  childOrderById.set(node.id, node.children.map((c) => c.id));
  for (const c of node.children) collectChildOrder(c, childOrderById);
}

function buildUnityPrefabYaml(
  ir: IR,
  frameName: string,
  frameWidth: number,
  frameHeight: number,
  roots: FlatNode[],
  runtimeProfile: UnityVersionProfile,
  textureGuidByAssetRef: Map<string, string>,
  fontGuidByKey: ReadonlyMap<string, string>,
): string {
  const ctx: UnityPrefabContext = {
    lines: ['%YAML 1.1', '%TAG !u! tag:unity3d.com,2011:'],
    nextFileId: 100001,
    textureGuidByAssetRef,
    rootHeight: frameHeight,
    nodeIdsById: new Map(),
    childOrderById: new Map(),
  };

  const prefabRootNodeId = '__prefab_root__';
  ctx.childOrderById.set(prefabRootNodeId, []);
  const rootGameObjectId = allocFileId(ctx);
  const rootTransformId = allocFileId(ctx);
  const rootCanvasRendererId = allocFileId(ctx);
  ctx.nodeIdsById.set(prefabRootNodeId, { gameObjectId: rootGameObjectId, transformId: rootTransformId });

  for (const node of roots) {
    const gameObjectId = allocFileId(ctx);
    const transformId = allocFileId(ctx);
    ctx.nodeIdsById.set(node.id, { gameObjectId, transformId });
    collectChildOrder(node, ctx.childOrderById);
  }
  ctx.childOrderById.set(prefabRootNodeId, roots.map((r) => r.id));

  for (const node of roots) {
    const stack: FlatNode[] = [node];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const c of cur.children) {
        if (!ctx.nodeIdsById.has(c.id)) {
          const gameObjectId = allocFileId(ctx);
          const transformId = allocFileId(ctx);
          ctx.nodeIdsById.set(c.id, { gameObjectId, transformId });
        }
        stack.push(c);
      }
    }
  }

  emitGameObject(ctx, rootGameObjectId, safeName(frameName), [rootTransformId, rootCanvasRendererId], true);
  emitRectTransform(
    ctx,
    rootTransformId,
    rootGameObjectId,
    0,
    {
      anchorMinX: 0.5,
      anchorMinY: 0.5,
      anchorMaxX: 0.5,
      anchorMaxY: 0.5,
      anchoredX: 0,
      anchoredY: 0,
      sizeDeltaX: frameWidth,
      sizeDeltaY: frameHeight,
    },
    (ctx.childOrderById.get(prefabRootNodeId) ?? []).map((id) => ctx.nodeIdsById.get(id)!.transformId),
  );
  emitCanvasRenderer(ctx, rootCanvasRendererId, rootGameObjectId);

  const queue: { node: FlatNode; parentId: string; parentWidth: number; parentHeight: number }[] = roots.map((n) => ({
    node: n,
    parentId: prefabRootNodeId,
    parentWidth: frameWidth,
    parentHeight: frameHeight,
  }));
  while (queue.length > 0) {
    const { node, parentId, parentWidth, parentHeight } = queue.shift()!;
    const ids = ctx.nodeIdsById.get(node.id)!;
    const parentTransformId = ctx.nodeIdsById.get(parentId)!.transformId;
    const childTransformIds = (ctx.childOrderById.get(node.id) ?? []).map((id) => ctx.nodeIdsById.get(id)!.transformId);

    const extraComponentIds: number[] = [];
    const canvasRendererId = allocFileId(ctx);
    extraComponentIds.push(canvasRendererId);
    let imageId: number | undefined;
    let textId: number | undefined;
    if (node.kind === 'sprite' || node.kind === 'slicedSprite') {
      imageId = allocFileId(ctx);
      extraComponentIds.push(imageId);
    }
    if (node.kind === 'text') {
      textId = allocFileId(ctx);
      extraComponentIds.push(textId);
    }

    emitGameObject(ctx, ids.gameObjectId, node.name, [ids.transformId, ...extraComponentIds], node.visible);
    const rectLayout = computeRectLayout(node, parentWidth, parentHeight);
    emitRectTransform(
      ctx,
      ids.transformId,
      ids.gameObjectId,
      parentTransformId,
      rectLayout,
      childTransformIds,
    );
    emitCanvasRenderer(ctx, canvasRendererId, ids.gameObjectId);
    if (imageId !== undefined) {
      emitUIImage(ctx, imageId, ids.gameObjectId, node.assetRef, node.opacity);
    }
    if (textId !== undefined && node.text) {
      const textKey = `${node.text.fontFamily}|${node.text.fontStyle}`;
      emitUIText(ctx, textId, ids.gameObjectId, node.text, fontGuidByKey.get(textKey));
    }

    for (const c of node.children) {
      queue.push({ node: c, parentId: node.id, parentWidth: node.width, parentHeight: node.height });
    }
  }

  return `${ctx.lines.join('\n')}\n`;
}

function makePrefabMeta(guid: string): string {
  return [
    'fileFormatVersion: 2',
    `guid: ${guid}`,
    'PrefabImporter:',
    '  externalObjects: {}',
    '  userData: ',
    '  assetBundleName: ',
    '  assetBundleVariant: ',
    '',
  ].join('\n');
}

function makeTextureMeta(guid: string, runtimeProfile: UnityVersionProfile): string {
  return [
    'fileFormatVersion: 2',
    `guid: ${guid}`,
    'TextureImporter:',
    '  internalIDToNameTable: []',
    '  externalObjects: {}',
    '  serializedVersion: 11',
    '  mipmaps:',
    '    mipMapMode: 0',
    '    enableMipMap: 0',
    '    sRGBTexture: 1',
    '  maxTextureSize: 2048',
    '  textureFormat: 1',
    '  textureCompression: 1',
    '  compressionQuality: 50',
    '  textureSettings:',
    '    serializedVersion: 2',
    '    filterMode: 1',
    '    aniso: 1',
    '    mipBias: 0',
    '    wrapU: 1',
    '    wrapV: 1',
    '    wrapW: 0',
    '  nPOTScale: 0',
    '  textureType: 8',
    '  textureShape: 1',
    '  spriteMode: 1',
    '  spriteExtrude: 1',
    '  spriteMeshType: 1',
    '  alignment: 0',
    '  spritePixelsToUnits: 100',
    '  spriteBorder: {x: 0, y: 0, z: 0, w: 0}',
    '  spritePivot: {x: 0.5, y: 0.5}',
    '  spriteGenerateFallbackPhysicsShape: 1',
    '  alphaUsage: 1',
    '  alphaIsTransparency: 1',
    '  spriteTessellationDetail: -1',
    '  platformSettings:',
    '  - serializedVersion: 3',
    '    buildTarget: DefaultTexturePlatform',
    '    maxTextureSize: 2048',
    '    resizeAlgorithm: 0',
    '    textureFormat: -1',
    '    textureCompression: 1',
    '    compressionQuality: 50',
    '    crunchedCompression: 0',
    '    allowsAlphaSplitting: 0',
    '    overridden: 0',
    '    androidETC2FallbackOverride: 0',
    '    forceMaximumCompressionQuality_BC6H_BC7: 0',
    '  - serializedVersion: 3',
    '    buildTarget: Android',
    '    maxTextureSize: 2048',
    '    resizeAlgorithm: 0',
    '    textureFormat: -1',
    '    textureCompression: 1',
    '    compressionQuality: 50',
    '    crunchedCompression: 0',
    '    allowsAlphaSplitting: 0',
    '    overridden: 0',
    '    androidETC2FallbackOverride: 0',
    '    forceMaximumCompressionQuality_BC6H_BC7: 0',
    `  userData: figma2gameui:${runtimeProfile}`,
    '  assetBundleName: ',
    '  assetBundleVariant: ',
    '',
  ].join('\n');
}

/** 与 `packAtlases` 写入 `textureByAssetRef` 的键一致。 */
function isAtlasTextureMapKey(assetRef: string): boolean {
  return assetRef.startsWith('atlas://');
}

function atlasSpriteAtlasBaseName(page: AtlasPage): string {
  return page.pngFileBaseName.replace(/\.png$/i, '') || page.atlasKey;
}

function makeSpriteAtlasYaml(page: AtlasPage, textureGuidByAssetRef: ReadonlyMap<string, string>): string {
  const lines: string[] = [
    '%YAML 1.1',
    '%TAG !u! tag:unity3d.com,2011:',
    '--- !u!687078895 &1',
    'SpriteAtlas:',
    '  m_ObjectHideFlags: 0',
    '  m_CorrespondingSourceObject: {fileID: 0}',
    '  m_PrefabInstance: {fileID: 0}',
    '  m_PrefabAsset: {fileID: 0}',
    `  m_Name: ${atlasSpriteAtlasBaseName(page)}`,
    '  m_EditorData:',
    '    packables:',
  ];
  const ordered = [...page.sprites].sort((a, b) => (a.assetRef < b.assetRef ? -1 : a.assetRef > b.assetRef ? 1 : 0));
  for (const sprite of ordered) {
    const guid = textureGuidByAssetRef.get(sprite.assetRef);
    if (!guid) continue;
    lines.push(`    - {fileID: 21300000, guid: ${guid}, type: 3}`);
  }
  lines.push('  m_IsVariant: 0');
  return `${lines.join('\n')}\n`;
}

function makeSpriteAtlasMeta(guid: string): string {
  return [
    'fileFormatVersion: 2',
    `guid: ${guid}`,
    'NativeFormatImporter:',
    '  externalObjects: {}',
    '  mainObjectFileID: 687078895',
    '  userData: ',
    '  assetBundleName: ',
    '  assetBundleVariant: ',
    '',
  ].join('\n');
}

function buildSpriteAtlasFiles(
  root: string,
  textureDir: string,
  atlasLayout: AtlasLayout,
  textureGuidByAssetRef: ReadonlyMap<string, string>,
): OutputFile[] {
  const files: OutputFile[] = [];
  const pages = [...atlasLayout.pages].sort((a, b) => (a.atlasKey < b.atlasKey ? -1 : a.atlasKey > b.atlasKey ? 1 : 0));
  for (const page of pages) {
    const spriteAtlasRel = joinPath(root, textureDir, `${atlasSpriteAtlasBaseName(page)}.spriteatlas`);
    const spriteAtlasGuid = newUnityGuid();
    files.push({
      path: spriteAtlasRel,
      data: encodeUtf8(makeSpriteAtlasYaml(page, textureGuidByAssetRef)),
    });
    files.push({
      path: `${spriteAtlasRel}.meta`,
      data: encodeUtf8(makeSpriteAtlasMeta(spriteAtlasGuid)),
    });
  }
  return files;
}

function makeFontMeta(guid: string, runtimeProfile: UnityVersionProfile): string {
  return [
    'fileFormatVersion: 2',
    `guid: ${guid}`,
    'TrueTypeFontImporter:',
    '  externalObjects: {}',
    '  serializedVersion: 4',
    '  fontSize: 16',
    '  forceTextureCase: -1',
    `  userData: figma2gameui:${runtimeProfile}`,
    '  assetBundleName: ',
    '  assetBundleVariant: ',
    '',
  ].join('\n');
}

function buildUnityPrefabFile(
  root: string,
  prefabDir: string,
  ir: IR,
  runtimeProfile: UnityVersionProfile,
  textureGuidByAssetRef: Map<string, string>,
  fontGuidByKey: ReadonlyMap<string, string>,
): OutputFile[] {
  const files: OutputFile[] = [];
  for (const frame of ir.frames) {
    const prefabName = `${safeName(frame.name)}.prefab`;
    const prefabRel = joinPath(root, prefabDir, prefabName);
    const prefabGuid = newUnityGuid();
    const nodes = frame.children.map((n) => flattenNode(n));
    const yaml = buildUnityPrefabYaml(
      ir,
      frame.name,
      frame.width,
      frame.height,
      nodes,
      runtimeProfile,
      textureGuidByAssetRef,
      fontGuidByKey,
    );
    files.push({ path: prefabRel, data: encodeUtf8(yaml) });
    files.push({ path: `${prefabRel}.meta`, data: encodeUtf8(makePrefabMeta(prefabGuid)) });
  }
  return files;
}

function buildTextureFiles(
  root: string,
  textureDir: string,
  textureByAssetRef: ReadonlyMap<string, TextureBytesPayload>,
  runtimeProfile: UnityVersionProfile,
  textureGuidByAssetRef: Map<string, string>,
): OutputFile[] {
  const files: OutputFile[] = [];
  for (const [assetRef, payload] of textureByAssetRef) {
    const fileRel = joinPath(root, textureDir, baseName(assetRef));
    const guid = newUnityGuid();
    textureGuidByAssetRef.set(assetRef, guid);
    files.push({
      path: fileRel,
      data: payload.bytes,
    });
    files.push({
      path: `${fileRel}.meta`,
      data: encodeUtf8(makeTextureMeta(guid, runtimeProfile)),
    });
  }
  return files;
}

function buildFontFiles(
  root: string,
  fontDir: string,
  fontByKey: ReadonlyMap<string, FontBytesPayload>,
  runtimeProfile: UnityVersionProfile,
  fontGuidByKey: Map<string, string>,
): OutputFile[] {
  const files: OutputFile[] = [];
  for (const [fontKey, payload] of fontByKey) {
    const fileRel = joinPath(root, fontDir, safeName(baseName(payload.fileName)));
    const guid = newUnityGuid();
    fontGuidByKey.set(fontKey, guid);
    files.push({
      path: fileRel,
      data: payload.bytes,
    });
    files.push({
      path: `${fileRel}.meta`,
      data: encodeUtf8(makeFontMeta(guid, runtimeProfile)),
    });
  }
  return files;
}

export class UnityEmitter implements Emitter {
  readonly descriptor: EmitterDescriptor = {
    id: 'unity',
    name: 'Unity UGUI',
    engineVersions: ['2019.4.x', '2020.1.x', '2021.1.x', '2022.1.x'],
    capabilities: ['sprite', 'text', 'mask', 'layout', 'slicedSprite'],
  };

  emit(input: EmitInput): EmitOutput {
    const settings = input.settings as UnityEmitterSettings;
    const root = validateAssetsRelativeRoot(settings.assetsRootRelative || '_figma_export');
    const prefabDir = validateAssetsRelativeRoot(settings.prefabsRelativeDir || 'prefabs');
    const textureDir = validateAssetsRelativeRoot(settings.texturesRelativeDir || 'textures');
    const fontDir = validateAssetsRelativeRoot(settings.fontsRelativeDir || 'fonts');
    const runtimeProfile = normalizeUnityVersionProfile(input.engineVersion || '2022.1.x');
    const files: OutputFile[] = [];
    const textureGuidByAssetRef = new Map<string, string>();
    const fontGuidByKey = new Map<string, string>();

    if (settings.includeTextures !== false) {
      if (settings.atlasLayout) {
        const textureMap = settings.textureByAssetRef ?? new Map();
        const standaloneTextureMap = new Map(
          [...textureMap].filter(([assetRef]) => !isAtlasTextureMapKey(assetRef)),
        );
        files.push(
          ...buildTextureFiles(root, textureDir, standaloneTextureMap, runtimeProfile, textureGuidByAssetRef),
        );
        files.push(...buildSpriteAtlasFiles(root, textureDir, settings.atlasLayout, textureGuidByAssetRef));
      } else {
        files.push(
          ...buildTextureFiles(root, textureDir, settings.textureByAssetRef ?? new Map(), runtimeProfile, textureGuidByAssetRef),
        );
      }
    }
    if (settings.includeFonts !== false) {
      files.push(...buildFontFiles(root, fontDir, settings.fontByKey ?? new Map(), runtimeProfile, fontGuidByKey));
    }

    if (settings.includePrefabs !== false) {
      files.push(
        ...buildUnityPrefabFile(
          root,
          prefabDir,
          input.ir,
          runtimeProfile,
          textureGuidByAssetRef,
          fontGuidByKey,
        ),
      );
    }

    const manifest = {
      format: 'figma2gameui/unity-export-manifest@1',
      requestedVersion: input.engineVersion,
      runtimeProfile,
      output: {
        prefabs: files.filter((f) => f.path.endsWith('.prefab')).map((f) => f.path),
        textures: files
          .filter(
            (f) =>
              f.path.includes(`/${textureDir}/`) &&
              !f.path.endsWith('.meta') &&
              !f.path.endsWith('.spriteatlas'),
          )
          .map((f) => f.path),
        fonts: files.filter((f) => f.path.includes(`/${fontDir}/`) && !f.path.endsWith('.meta')).map((f) => f.path),
        spriteAtlases: files
          .filter((f) => f.path.includes(`/${textureDir}/`) && f.path.endsWith('.spriteatlas'))
          .map((f) => f.path),
      },
    };
    files.push({
      path: joinPath(root, 'unity-export.manifest.json'),
      data: encodeJson(manifest),
    });

    if (settings.includePrefabs !== false) {
      for (const p of manifest.output.prefabs) {
        const rel = p.replace(`${root}/`, '');
        const prefabFile = files.find((f) => f.path === p);
        if (!prefabFile) continue;
        const content = decodeBytes(prefabFile.data);
        if (!content.includes('RectTransform:')) {
          return { files, warnings: [{ level: 'warning', message: `Unity prefab missing RectTransform: ${rel}` }] };
        }
      }
    }

    return { files, warnings: [] };
  }
}

