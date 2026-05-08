export type DiscoveredExport = {
  frameNode: FrameNode;
  exportRoots: SceneNode[];
  allExportNodes: SceneNode[];
};

export type RasterResult = {
  nodeId: string;
  assetRef: string;
  bytes: Uint8Array;
  width: number;
  height: number;
};

export type ExportSettings = {
  engineId: string;
  engineVersion: string;
  assetsRootRelative: string;
  prefabsRelativeDir: string;
  texturesRelativeDir: string;
  fontsRelativeDir: string;
  includePrefabs: boolean;
  includeTextures: boolean;
  includeFonts: boolean;
  /** Figma Constraints → 引擎对齐（如 cc.Widget、UGUI RectTransform 锚点）。默认开启。 */
  exportConstraintsEnabled: boolean;
  /**
   * 与 exportConstraintsEnabled 同时为 true 时：Cocos 3 等为每张预制体根节点写入四边铺满的 Widget。
   */
  widgetRootFillScreen: boolean;
  /** Figma Auto Layout → IR `layout`（flex）。默认开启。 */
  exportFigmaAutoLayoutEnabled: boolean;
  attachDebugIr: boolean;
  /** 为 true 时 PNG 写入 `textures/{primaryGroup}/...`（发射器侧实现）。 */
  textureSubdirByPrimaryGroup: boolean;
  /** 方案 3：导出节点 id → 手工组 id（MVP 可为空 Map）。 */
  manualTextureGroupByExportNodeId?: ReadonlyMap<string, string>;
  /** UI 勾选：希望进行图集打包（实际执行仍受授权约束）。 */
  atlasPackingRequested: boolean;
  /** 是否允许执行图集打包（MVP：等同开发解锁；后续可并入许可）。 */
  atlasPackingAuthorized: boolean;
  /** 图集单边像素上限（取 2 的幂：64…4096，具体打包器消费）。 */
  atlasMaxSide: number;
  /**
   * 单张贴图面积 ≥ `atlasMaxSide² × 该值` 时视为「大图」不参与合图（仍散图）。
   * 范围 0.1–0.9，与插件 Slider 一致。
   */
  atlasLargeSpriteAreaRatioThreshold: number;
  fontFiles: ReadonlyMap<string, { fileName: string; bytes: Uint8Array }>;
  fontUuidOverrides: ReadonlyMap<string, string>;
  engineSpecific: Record<string, unknown>;
};
