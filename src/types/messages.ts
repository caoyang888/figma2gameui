import type { ReportEntry } from '../core/report';
import type { EmitterDescriptor } from '../domain/emitters/types';
import type { FrameTreeNodeWire } from './frameTree';

/** 可经 postMessage 序列化的文件载荷（二进制为普通数组）。 */
export type ExportFileWire = {
  path: string;
  data: number[];
};

export type ExportResultPayload = {
  ok: boolean;
  report: ReportEntry[];
  files: ExportFileWire[];
  /** 为 true 时表示仅前置校验（非 ZIP 导出），UI 不应覆盖已展示的导出报告。 */
  dryRun?: boolean;
};

export type ExportFontFileWire = {
  fileName: string;
  data: number[];
};

export type ExportRequestMessage = {
  type: 'EXPORT_REQUEST';
  payload?: {
    fontFiles?: Record<string, ExportFontFileWire>;
  };
};

export type ExportResultMessage = {
  type: 'EXPORT_RESULT';
  payload: ExportResultPayload;
};

/** 导出过程中主线程推送的进度（ratio 0~1）。 */
export type ExportProgressPayload = {
  label: string;
  ratio: number;
};

export type FrameTreePayload = {
  roots: FrameTreeNodeWire[];
};

/** 主线程 → UI：完整设置快照（与 `postSettingsState` 一致）。 */
export type SettingsStatePayload = {
  exportRoot: string;
  prefabRel: string;
  textureRel: string;
  fontRel: string;
  fontMap: Record<string, string>;
  fontUuidMap: Record<string, string>;
  attachDebugIr: boolean;
  textureSubdirByPrimaryGroup: boolean;
  pathDetailsExpanded: boolean;
  devUiVisible: boolean;
  exportFrameIds: string[];
  includePrefabs: boolean;
  includeTextures: boolean;
  includeFonts: boolean;
  exportConstraintsEnabled: boolean;
  widgetRootFillScreen: boolean;
  exportFigmaAutoLayoutEnabled: boolean;
  engineId: string;
  engineVersion: string;
  atlasPackingRequested: boolean;
  /** 与 `atlasPackingAuthorized` 同源持久化字段；MVP 下二者一致。 */
  atlasPackingDevUnlock: boolean;
  atlasPackingAuthorized: boolean;
  atlasMaxSide: number;
  /** 大图面积阈值（0.1–0.9），见 `ExportSettings.atlasLargeSpriteAreaRatioThreshold`。 */
  atlasLargeSpriteAreaRatio: number;
  availableEngines: EmitterDescriptor[];
};

/** UI → 主线程：`SAVE_SETTINGS` 载荷（字段与 `handleSaveSettings` 对齐）。 */
export type SaveSettingsPayload = {
  exportRoot?: string;
  prefabRel?: string;
  textureRel?: string;
  fontRel?: string;
  fontMap?: Record<string, string>;
  fontUuidMap?: Record<string, string>;
  attachDebugIr?: boolean;
  textureSubdirByPrimaryGroup?: boolean;
  pathDetailsExpanded?: boolean;
  devUiVisible?: boolean;
  selectedFrameIds?: string[];
  includePrefabs?: boolean;
  includeTextures?: boolean;
  includeFonts?: boolean;
  exportConstraintsEnabled?: boolean;
  widgetRootFillScreen?: boolean;
  exportFigmaAutoLayoutEnabled?: boolean;
  engineId?: string;
  engineVersion?: string;
  atlasPackingRequested?: boolean;
  atlasPackingDevUnlock?: boolean;
  atlasMaxSide?: number | string;
  atlasLargeSpriteAreaRatio?: number;
};

export type SettingsStateMessage = {
  type: 'SETTINGS_STATE';
  payload: SettingsStatePayload;
};

export type SaveSettingsMessage = {
  type: 'SAVE_SETTINGS';
  payload: SaveSettingsPayload;
};

/** UI 语言偏好（与 `LocalePreference` 一致）。 */
export type UiLocalePreference = 'auto' | 'en' | 'zh-Hans' | 'zh-Hant';

export type UiLocaleStatePayload = {
  preference: UiLocalePreference;
};

export type UiLocaleStateMessage = {
  type: 'UI_LOCALE_STATE';
  payload: UiLocaleStatePayload;
};

export type UiLocaleSaveMessage = {
  type: 'UI_LOCALE_SAVE';
  payload: UiLocaleStatePayload;
};

export type UiLocaleGetRequestMessage = {
  type: 'UI_LOCALE_GET_REQUEST';
};
