export type ExportEngineOption = {
  key: string;
  label: string;
  engineId: string;
  engineVersion: string;
  supported: boolean;
};

/** 引擎版本配置：统一驱动展示、持久化与业务支持性判断。 */
export const EXPORT_ENGINE_OPTIONS: readonly ExportEngineOption[] = [
  { key: 'unity-2019.4-plus', label: 'unity2019.4+', engineId: 'unity', engineVersion: '2019.4.x', supported: true },
  { key: 'cocos-2.4', label: 'cocos 2.4.x', engineId: 'cocos-creator-2', engineVersion: '2.4.x', supported: true },
  { key: 'cocos-3.8.x', label: 'cocos3.8.x', engineId: 'cocos-creator-3', engineVersion: '3.8.x', supported: true },
];
