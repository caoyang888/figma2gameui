/**
 * 引擎无关的合图（atlas）布局描述：每张合图页对应一张 PNG，子图在页内以像素矩形定位。
 */

/**
 * 单张合图内，canonical assetRef 的像素区域（左上角为原点，y 向下与 Figma 导出 PNG 一致）。
 */
export type AtlasSpriteEntry = {
  assetRef: string;
  /** 在 atlas 纹理中的像素矩形 */
  rect: { x: number; y: number; width: number; height: number };
  /** 与 IR 中 sprite 布局一致的逻辑尺寸（MVP 可与 rect 同尺寸，无 trim） */
  sourceSize: { width: number; height: number };
};

export type AtlasPage = {
  /** 稳定键，如 `atlas-0` / `atlas-shop` */
  atlasKey: string;
  /** 写入 zip 的文件名基名（无路径）；完整相对路径由 emitter 与现有 textures 目录规则拼接 */
  pngFileBaseName: string;
  width: number;
  height: number;
  sprites: AtlasSpriteEntry[];
};

/** 与管线输出一并序列化或传入 emitter 的合图布局根对象 */
export type AtlasLayout = {
  version: 1;
  pages: AtlasPage[];
};
