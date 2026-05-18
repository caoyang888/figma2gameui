import './polyfills/textEncoding';
import { MessageRouter } from './platform/messaging';
import { settings } from './platform/settings';
import { ProgressReporter } from './pipeline/progress';
import { ReportCollector } from './pipeline/report';
import { runExportPipeline } from './pipeline/orchestrator';
import { EmitterRegistry } from './domain/emitters/registry';
import { TransformRegistry } from './domain/ir/transforms/registry';
import { ConfigFeatureGate } from './platform/featureGate';
import { CocosCreator3Emitter } from './domain/emitters/cocos3/index';
import { CocosCreator2Emitter } from './domain/emitters/cocos2';
import { UnityEmitter } from './domain/emitters/unity';
import { buildFrameTreeRoots } from './domain/discovery/frameTree';
import {
  buildFontRegistryFromExportFrames,
  expandFontMapByAliases,
  expandFontRecordByAliases,
  remapFontRecord,
} from './domain/discovery/fontScan';
import {
  buildNoFramesResolvedMessage,
  resolveFramesByIds,
  resolveFramesByIdsDetailed,
} from './domain/discovery/selection';
import { validateAssetsRelativeRoot } from './shared/pathValidation';
import type { ExportSettings } from './pipeline/context';
import { LOCALE_STORAGE_KEY } from './ui/i18n/constants';
import type { UiLocalePreference } from './types/messages';

// --- Registries ---
const emitterRegistry = new EmitterRegistry();
emitterRegistry.register(new CocosCreator2Emitter());
emitterRegistry.register(new CocosCreator3Emitter());
emitterRegistry.register(new UnityEmitter());
const transformRegistry = new TransformRegistry();
const featureGate = new ConfigFeatureGate({});

// --- UI ---
figma.showUI(__html__, { width: 1080, height: 780 });

// --- Helpers ---

function postSettingsState(): void {
  figma.ui.postMessage({
    type: 'SETTINGS_STATE',
    payload: {
      exportRoot: settings.loadExportRoot(),
      prefabRel: settings.loadPrefabRel(),
      textureRel: settings.loadTextureRel(),
      fontRel: settings.loadFontRel(),
      fontMap: remapFontRecord(settings.loadFontMap()),
      fontUuidMap: remapFontRecord(settings.loadFontUuidMap()),
      attachDebugIr: settings.loadAttachDebugIr(),
      textureSubdirByPrimaryGroup: settings.loadTextureSubdirByPrimaryGroup(),
      pathDetailsExpanded: settings.loadPathDetailsExpanded(),
      devUiVisible: settings.loadDevUiVisible(),
      exportFrameIds: settings.loadExportFrameIds(),
      includePrefabs: settings.loadIncludePrefabs(),
      includeTextures: settings.loadIncludeTextures(),
      includeFonts: settings.loadIncludeFonts(),
      exportConstraintsEnabled: settings.loadExportConstraintsEnabled(),
      widgetRootFillScreen: settings.loadWidgetRootFillScreen(),
      exportFigmaAutoLayoutEnabled: settings.loadExportFigmaAutoLayoutEnabled(),
      engineId: settings.loadEngineId(),
      engineVersion: settings.loadEngineVersion(),
      atlasPackingRequested: settings.loadAtlasPackingRequested(),
      atlasPackingDevUnlock: settings.loadAtlasPackingDevUnlock(),
      atlasPackingAuthorized: settings.loadAtlasPackingDevUnlock(),
      atlasMaxSide: settings.loadAtlasMaxSide(),
      atlasLargeSpriteAreaRatio: settings.loadAtlasLargeSpriteAreaRatio(),
      availableEngines: emitterRegistry.list(),
    },
  });
}

function postFrameTreeMessage(): void {
  figma.ui.postMessage({ type: 'FRAME_TREE', payload: { roots: buildFrameTreeRoots() } });
}

function postFontKeys(): void {
  const frames = resolveFramesByIds(settings.loadExportFrameIds());
  const registry = buildFontRegistryFromExportFrames(frames);
  figma.ui.postMessage({ type: 'FONT_KEYS_RESPONSE', payload: { keys: registry.keys } });
}

function isLikelyUuid(value: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(value);
}

function isUiLocalePreference(v: unknown): v is UiLocalePreference {
  return v === 'auto' || v === 'en' || v === 'zh-Hans' || v === 'zh-Hant';
}

async function loadUiLocalePreference(): Promise<UiLocalePreference> {
  try {
    const v = await figma.clientStorage.getAsync(LOCALE_STORAGE_KEY);
    return isUiLocalePreference(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

async function saveUiLocalePreference(pref: UiLocalePreference): Promise<void> {
  try {
    await figma.clientStorage.setAsync(LOCALE_STORAGE_KEY, pref);
  } catch {
    // 忽略持久化失败
  }
}

function postUiLocaleState(preference: UiLocalePreference): void {
  figma.ui.postMessage({ type: 'UI_LOCALE_STATE', payload: { preference } });
}

function parseFrameIdsFromPayload(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  return raw.filter((x): x is string => typeof x === 'string');
}

function persistExportFrameIds(ids: string[]): void {
  settings.saveExportFrameIds(ids);
}

function loadExportFrameIdsPreferPayload(payloadIds: string[] | null): string[] {
  if (payloadIds !== null) {
    persistExportFrameIds(payloadIds);
    return payloadIds;
  }
  return settings.loadExportFrameIds();
}

function postDryRunResult(frameIdsOverride?: readonly string[]): void {
  const report = new ReportCollector();
  const ids =
    frameIdsOverride !== undefined ? [...frameIdsOverride] : settings.loadExportFrameIds();
  const resolved = resolveFramesByIdsDetailed(ids);
  if (resolved.frames.length === 0) {
    report.add('error', buildNoFramesResolvedMessage(resolved));
    figma.ui.postMessage({
      type: 'EXPORT_RESULT',
      payload: { ok: false, report: report.sortForDisplay(), files: [], dryRun: true },
    });
    return;
  }
  report.add('info', `已勾选 ${resolved.frames.length} 个 Frame。`);

  const includePrefabs = settings.loadIncludePrefabs();
  const includeTextures = settings.loadIncludeTextures();
  const includeFonts = settings.loadIncludeFonts();
  if (!includePrefabs && !includeTextures && !includeFonts) {
    report.add('error', '请至少勾选一种导出内容（预制体/图片/字体）。');
  }

  if (includeFonts) {
    const registry = buildFontRegistryFromExportFrames(resolved.frames);
    const usedKeys = registry.keys;
    const fontMap = remapFontRecord(settings.loadFontMap());
    for (const key of usedKeys) {
      if (!fontMap[key] || fontMap[key].trim() === '') {
        report.add('error', `缺少字体文件映射（TTF）：${key}`);
      }
    }
    const uuidMap = remapFontRecord(settings.loadFontUuidMap());
    for (const [key, value] of Object.entries(uuidMap)) {
      const v = value.trim();
      if (v !== '' && !isLikelyUuid(v)) {
        report.add('error', `字体 UUID 格式不合法：${key} -> ${v}`);
      }
    }
  }

  figma.ui.postMessage({
    type: 'EXPORT_RESULT',
    payload: {
      ok: !report.hasErrors(),
      report: report.sortForDisplay(),
      files: [],
      dryRun: true,
    },
  });
}

type ExportFontFileWire = { fileName: string; data: number[] };

async function handleExport(payload?: {
  fontFiles?: Record<string, ExportFontFileWire>;
  selectedFrameIds?: unknown[];
}): Promise<void> {
  const fontFiles = new Map<string, { fileName: string; bytes: Uint8Array }>();
  if (payload?.fontFiles) {
    for (const [key, file] of Object.entries(payload.fontFiles)) {
      if (!file || typeof file.fileName !== 'string' || !Array.isArray(file.data)) continue;
      if (!file.fileName.toLowerCase().endsWith('.ttf')) continue;
      fontFiles.set(key, { fileName: file.fileName, bytes: new Uint8Array(file.data) });
    }
  }

  const frameIdsForFonts = loadExportFrameIdsPreferPayload(parseFrameIdsFromPayload(payload?.selectedFrameIds));
  const fontRegistry = buildFontRegistryFromExportFrames(resolveFramesByIds(frameIdsForFonts));
  const fontUuidMap = expandFontRecordByAliases(
    remapFontRecord(settings.loadFontUuidMap()),
    fontRegistry.aliasToCanonical,
  );
  const fontUuidOverrides = new Map<string, string>();
  for (const [k, v] of Object.entries(fontUuidMap)) {
    const uuid = (v || '').trim();
    if (uuid !== '' && isLikelyUuid(uuid)) fontUuidOverrides.set(k, uuid);
  }
  const expandedFontFiles = expandFontMapByAliases(fontFiles, fontRegistry.aliasToCanonical);

  const exportSettings: ExportSettings = {
    engineId: settings.loadEngineId(),
    engineVersion: settings.loadEngineVersion(),
    assetsRootRelative: settings.loadExportRoot(),
    prefabsRelativeDir: settings.loadPrefabRel(),
    texturesRelativeDir: settings.loadTextureRel(),
    fontsRelativeDir: settings.loadFontRel(),
    includePrefabs: settings.loadIncludePrefabs(),
    includeTextures: settings.loadIncludeTextures(),
    includeFonts: settings.loadIncludeFonts(),
    exportConstraintsEnabled: settings.loadExportConstraintsEnabled(),
    widgetRootFillScreen: settings.loadWidgetRootFillScreen(),
    exportFigmaAutoLayoutEnabled: settings.loadExportFigmaAutoLayoutEnabled(),
    attachDebugIr: settings.loadAttachDebugIr(),
    textureSubdirByPrimaryGroup: settings.loadTextureSubdirByPrimaryGroup(),
    atlasPackingRequested: settings.loadAtlasPackingRequested(),
    atlasPackingAuthorized: settings.loadAtlasPackingDevUnlock(),
    atlasMaxSide: settings.loadAtlasMaxSide(),
    atlasLargeSpriteAreaRatioThreshold: settings.loadAtlasLargeSpriteAreaRatio(),
    manualTextureGroupByExportNodeId: new Map(),
    fontFiles: expandedFontFiles,
    fontUuidOverrides,
    engineSpecific: {},
  };

  const progress = new ProgressReporter((label, ratio) => {
    figma.ui.postMessage({ type: 'EXPORT_PROGRESS', payload: { label, ratio } });
  });

  const frameIds = loadExportFrameIdsPreferPayload(parseFrameIdsFromPayload(payload?.selectedFrameIds));

  const result = await runExportPipeline(
    frameIds,
    exportSettings,
    { emitterRegistry, transformRegistry, featureGate },
    progress,
  );
  figma.ui.postMessage({
    type: 'EXPORT_RESULT',
    payload: { ...result, dryRun: false },
  });
}

function handleSaveSettings(p: Record<string, unknown>): void {
  try {
    settings.saveExportRoot(validateAssetsRelativeRoot(typeof p.exportRoot === 'string' ? p.exportRoot : ''));
    settings.savePrefabRel(validateAssetsRelativeRoot(typeof p.prefabRel === 'string' ? p.prefabRel : ''));
    settings.saveTextureRel(validateAssetsRelativeRoot(typeof p.textureRel === 'string' ? p.textureRel : ''));
    settings.saveFontRel(validateAssetsRelativeRoot(typeof p.fontRel === 'string' ? p.fontRel : ''));

    const clean: Record<string, string> = {};
    if (p.fontMap && typeof p.fontMap === 'object' && !Array.isArray(p.fontMap)) {
      for (const [k, v] of Object.entries(p.fontMap as Record<string, unknown>)) {
        if (typeof v === 'string') clean[k] = v;
      }
    }
    settings.saveFontMap(remapFontRecord(clean));

    const cleanUuid: Record<string, string> = {};
    if (p.fontUuidMap && typeof p.fontUuidMap === 'object' && !Array.isArray(p.fontUuidMap)) {
      for (const [k, v] of Object.entries(p.fontUuidMap as Record<string, unknown>)) {
        if (typeof v === 'string') cleanUuid[k] = v;
      }
    }
    settings.saveFontUuidMap(remapFontRecord(cleanUuid));

    settings.saveAttachDebugIr(Boolean(p.attachDebugIr));
    settings.saveIncludePrefabs(p.includePrefabs !== false);
    settings.saveIncludeTextures(p.includeTextures !== false);
    settings.saveIncludeFonts(p.includeFonts !== false);
    if (typeof p.exportConstraintsEnabled === 'boolean') {
      settings.saveExportConstraintsEnabled(p.exportConstraintsEnabled);
    }
    if (typeof p.widgetRootFillScreen === 'boolean') {
      settings.saveWidgetRootFillScreen(p.widgetRootFillScreen);
    }
    if (typeof p.exportFigmaAutoLayoutEnabled === 'boolean') {
      settings.saveExportFigmaAutoLayoutEnabled(p.exportFigmaAutoLayoutEnabled);
    }
    if (typeof p.textureSubdirByPrimaryGroup === 'boolean') {
      settings.saveTextureSubdirByPrimaryGroup(p.textureSubdirByPrimaryGroup);
    }
    if (typeof p.engineId === 'string') settings.saveEngineId(p.engineId);
    if (typeof p.engineVersion === 'string') settings.saveEngineVersion(p.engineVersion);
    if (typeof p.pathDetailsExpanded === 'boolean') settings.savePathDetailsExpanded(p.pathDetailsExpanded);
    if (typeof p.devUiVisible === 'boolean') settings.saveDevUiVisible(p.devUiVisible);
    if (typeof p.atlasPackingRequested === 'boolean') {
      settings.saveAtlasPackingRequested(p.atlasPackingRequested);
    }
    if (typeof p.atlasPackingDevUnlock === 'boolean') {
      settings.saveAtlasPackingDevUnlock(p.atlasPackingDevUnlock);
    }
    if (typeof p.atlasMaxSide === 'number' && Number.isFinite(p.atlasMaxSide)) {
      settings.saveAtlasMaxSide(p.atlasMaxSide);
    } else if (typeof p.atlasMaxSide === 'string') {
      const parsed = Number.parseInt(p.atlasMaxSide, 10);
      if (Number.isFinite(parsed)) settings.saveAtlasMaxSide(parsed);
    }
    if (typeof p.atlasLargeSpriteAreaRatio === 'number' && Number.isFinite(p.atlasLargeSpriteAreaRatio)) {
      settings.saveAtlasLargeSpriteAreaRatio(p.atlasLargeSpriteAreaRatio);
    }
    if (Array.isArray(p.selectedFrameIds)) {
      settings.saveExportFrameIds((p.selectedFrameIds as unknown[]).filter((x): x is string => typeof x === 'string'));
    }

    postDryRunResult();
    postFontKeys();
  } catch (err) {
    figma.notify(err instanceof Error ? err.message : String(err));
  }
}

// --- Router ---
const router = new MessageRouter();

router.on('PING', () => { figma.ui.postMessage({ type: 'PONG' }); });

router.on('READY', () => {
  postSettingsState();
  postFrameTreeMessage();
  postDryRunResult();
  postFontKeys();
  void (async () => {
    const preference = await loadUiLocalePreference();
    postUiLocaleState(preference);
  })();
});

router.on('UI_LOCALE_GET_REQUEST', () => {
  void (async () => {
    const preference = await loadUiLocalePreference();
    postUiLocaleState(preference);
  })();
});

router.on('UI_LOCALE_SAVE', (msg: { type: string; payload?: { preference?: unknown } }) => {
  const p = msg.payload?.preference;
  if (isUiLocalePreference(p)) void saveUiLocalePreference(p);
});

router.on('EXPORT_DRY_RUN', () => {
  postSettingsState();
  postFrameTreeMessage();
  postDryRunResult();
  postFontKeys();
});

router.on('UPDATE_EXPORT_FRAMES', (msg: { type: string; payload?: { selectedFrameIds?: unknown[] } }) => {
  const raw = msg.payload?.selectedFrameIds;
  const ids = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  settings.saveExportFrameIds(ids);
  postDryRunResult();
  postFontKeys();
});

router.on('FRAME_TREE_REQUEST', () => { postFrameTreeMessage(); });

router.on('FONT_KEYS_REQUEST', () => { postFontKeys(); });

router.on(
  'EXPORT_REQUEST',
  (msg: {
    type: string;
    payload?: { fontFiles?: Record<string, ExportFontFileWire>; selectedFrameIds?: unknown[] };
  }) => {
    void handleExport(msg.payload);
  },
);

router.on('SAVE_SETTINGS', (msg: { type: string; payload: Record<string, unknown> }) => {
  if (msg.payload && typeof msg.payload === 'object') handleSaveSettings(msg.payload);
});

figma.ui.onmessage = (msg: unknown) => { void router.dispatch(msg); };

// --- Document change debounce ---
let frameTreeDebounce: ReturnType<typeof setTimeout> | null = null;
void figma.loadAllPagesAsync().then(() => {
  figma.on('documentchange', () => {
    if (frameTreeDebounce !== null) clearTimeout(frameTreeDebounce);
    frameTreeDebounce = setTimeout(() => { frameTreeDebounce = null; postFrameTreeMessage(); }, 400);
  });
});
