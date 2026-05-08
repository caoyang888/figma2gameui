/**
 * Typed wrapper around figma.root.getPluginData / setPluginData.
 * Key names match the legacy pluginSettings.ts (no prefix) for backwards compatibility.
 * Boolean flags are stored as '1'/'0' to match the legacy format.
 */

import {
  ATLAS_LARGE_SPRITE_AREA_RATIO_DEFAULT,
  clampAtlasLargeSpriteAreaRatio,
  clampAtlasMaxSideToPot,
} from '../shared/atlasPackSettings';

function load(key: string): string | undefined {
  try { return figma.root.getPluginData(key) || undefined; } catch { return undefined; }
}

function save(key: string, value: string): void {
  try { figma.root.setPluginData(key, value); } catch { /* ignore */ }
}

function loadJson<T>(key: string, fallback: T): T {
  const raw = load(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function saveJson(key: string, value: unknown): void {
  save(key, JSON.stringify(value));
}

function loadBoolFlag(key: string, defaultValue: boolean): boolean {
  const raw = load(key);
  if (raw === undefined) return defaultValue;
  return raw === '1';
}

function saveBoolFlag(key: string, value: boolean): void {
  save(key, value ? '1' : '0');
}

export const settings = {
  loadExportRoot: () => load('exportRoot') ?? '_figma_export',
  saveExportRoot: (v: string) => save('exportRoot', v),

  loadPrefabRel: () => load('prefabRel') ?? 'prefabs',
  savePrefabRel: (v: string) => save('prefabRel', v),

  loadTextureRel: () => load('textureRel') ?? 'textures',
  saveTextureRel: (v: string) => save('textureRel', v),

  loadFontRel: () => load('fontRel') ?? 'fonts',
  saveFontRel: (v: string) => save('fontRel', v),

  loadFontMap: () => loadJson<Record<string, string>>('fontMap', {}),
  saveFontMap: (v: Record<string, string>) => saveJson('fontMap', v),

  loadFontUuidMap: () => loadJson<Record<string, string>>('fontUuidMap', {}),
  saveFontUuidMap: (v: Record<string, string>) => saveJson('fontUuidMap', v),

  loadAttachDebugIr: () => loadBoolFlag('attachDebugIr', false),
  saveAttachDebugIr: (v: boolean) => saveBoolFlag('attachDebugIr', v),

  loadTextureSubdirByPrimaryGroup: () => loadBoolFlag('textureSubdirByGroup', false),
  saveTextureSubdirByPrimaryGroup: (v: boolean) => saveBoolFlag('textureSubdirByGroup', v),

  loadExportFrameIds: () => loadJson<string[]>('exportFrameIds', []),
  saveExportFrameIds: (v: string[]) => saveJson('exportFrameIds', v),

  loadIncludePrefabs: () => loadBoolFlag('includePrefabs', true),
  saveIncludePrefabs: (v: boolean) => saveBoolFlag('includePrefabs', v),

  loadIncludeTextures: () => loadBoolFlag('includeTextures', true),
  saveIncludeTextures: (v: boolean) => saveBoolFlag('includeTextures', v),

  loadIncludeFonts: () => loadBoolFlag('includeFonts', true),
  saveIncludeFonts: (v: boolean) => saveBoolFlag('includeFonts', v),

  loadEngineId: () => load('engineId') ?? 'cocos-creator-3',
  saveEngineId: (v: string) => save('engineId', v),

  loadEngineVersion: () => load('engineVersion') ?? '3.8.x',
  saveEngineVersion: (v: string) => save('engineVersion', v),

  loadPathDetailsExpanded: () => loadBoolFlag('pathDetailsExpanded', false),
  savePathDetailsExpanded: (v: boolean) => saveBoolFlag('pathDetailsExpanded', v),

  loadDevUiVisible: () => loadBoolFlag('devUiVisible', false),
  saveDevUiVisible: (v: boolean) => saveBoolFlag('devUiVisible', v),

  loadExportConstraintsEnabled: () => loadBoolFlag('exportConstraints', true),
  saveExportConstraintsEnabled: (v: boolean) => saveBoolFlag('exportConstraints', v),

  loadWidgetRootFillScreen: () => loadBoolFlag('widgetRootFillScreen', false),
  saveWidgetRootFillScreen: (v: boolean) => saveBoolFlag('widgetRootFillScreen', v),

  loadExportFigmaAutoLayoutEnabled: () => loadBoolFlag('exportFigmaAutoLayout', true),
  saveExportFigmaAutoLayoutEnabled: (v: boolean) => saveBoolFlag('exportFigmaAutoLayout', v),

  loadAtlasPackingRequested: () => loadBoolFlag('atlasPackingRequested', false),
  saveAtlasPackingRequested: (v: boolean) => saveBoolFlag('atlasPackingRequested', v),

  loadAtlasPackingDevUnlock: () => loadBoolFlag('atlasPackingDevUnlock', false),
  saveAtlasPackingDevUnlock: (v: boolean) => saveBoolFlag('atlasPackingDevUnlock', v),

  loadAtlasMaxSide: (): number => {
    const raw = load('atlasMaxSide');
    if (raw === undefined) {
      return clampAtlasMaxSideToPot(2048);
    }
    const n = Number.parseInt(raw, 10);
    return clampAtlasMaxSideToPot(n);
  },
  saveAtlasMaxSide: (v: number): void => {
    save('atlasMaxSide', String(clampAtlasMaxSideToPot(v)));
  },

  loadAtlasLargeSpriteAreaRatio: (): number => {
    const raw = load('atlasLargeSpriteAreaRatio');
    if (raw === undefined) {
      return ATLAS_LARGE_SPRITE_AREA_RATIO_DEFAULT;
    }
    const n = Number.parseFloat(raw);
    return clampAtlasLargeSpriteAreaRatio(n);
  },
  saveAtlasLargeSpriteAreaRatio: (v: number): void => {
    save('atlasLargeSpriteAreaRatio', String(clampAtlasLargeSpriteAreaRatio(v)));
  },
};
