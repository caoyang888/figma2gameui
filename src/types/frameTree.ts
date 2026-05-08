/** 可序列化到 UI 的文档树节点（含可导出的 Frame）。 */
export type FrameTreeNodeWire = {
  id: string;
  name: string;
  type: string;
  isExportFrame: boolean;
  children: FrameTreeNodeWire[];
};
