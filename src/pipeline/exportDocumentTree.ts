/// <reference types="@figma/plugin-typings" />
import type { NodeRole } from '../domain/discovery/annotate';
import { exportAssetRefForNodeId } from '../domain/ir/builder';
import type { ExportNodeAuditRow } from './textureGroups';
import { encodeUtf8 } from '../shared/utf8';

/** 单棵勾选 Frame 子树节点上限 */
export const DOCUMENT_TREE_MAX_NODES = 25_000;

function hasFigmaExportSettings(node: SceneNode): boolean {
  return (
    'exportSettings' in node &&
    Array.isArray(node.exportSettings) &&
    node.exportSettings.length > 0
  );
}

function figmaExportFormats(node: SceneNode): string[] {
  if (!hasFigmaExportSettings(node)) {
    return [];
  }
  const out: string[] = [];
  for (const s of node.exportSettings) {
    if (s && typeof s === 'object' && 'format' in s && typeof s.format === 'string') {
      out.push(s.format);
    }
  }
  return out;
}

function nodeDimensions(node: SceneNode): { width: number | null; height: number | null } {
  if ('width' in node && 'height' in node) {
    return { width: Number(node.width), height: Number(node.height) };
  }
  const bb = (node as SceneNode & { absoluteBoundingBox?: { width: number; height: number } | null })
    .absoluteBoundingBox;
  if (bb) {
    return { width: Number(bb.width), height: Number(bb.height) };
  }
  return { width: null, height: null };
}

function roleLabel(role: NodeRole | undefined): { pluginRole: string | null; rasterize: boolean | null } {
  if (!role) {
    return { pluginRole: null, rasterize: null };
  }
  if (role.role === 'passthrough' || role.role === 'pruned') {
    return { pluginRole: role.role, rasterize: null };
  }
  if (role.role === 'label') {
    return { pluginRole: 'label', rasterize: false };
  }
  return { pluginRole: role.role, rasterize: role.rasterize };
}

function pageInfoForFrame(frame: FrameNode): { pageId: string | null; pageName: string | null } {
  let p: BaseNode | null = frame.parent;
  while (p !== null) {
    if (p.type === 'PAGE') {
      return { pageId: p.id, pageName: p.name };
    }
    p = 'parent' in p ? (p.parent as BaseNode | null) : null;
  }
  return { pageId: null, pageName: null };
}

/** 勾选 Frame 子树内单个节点的调试信息 */
export type ExportDocumentTreeNodeWire = {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  width: number | null;
  height: number | null;
  hasFigmaExportSettings: boolean;
  figmaExportFormats: string[];
  isExportFrameRoot: boolean;
  pluginRole: string | null;
  rasterize: boolean | null;
  plannedRasterExport: boolean;
  assetRef: string | null;
  exportedTexture: boolean;
  spriteId: string | null;
  exportStatus: string | null;
  skipReason: string | null;
  textureGroupId: string | null;
  cycleDetected?: boolean;
  truncated?: boolean;
  children: ExportDocumentTreeNodeWire[];
};

export type ExportDocumentFrameWire = {
  frameId: string;
  frameName: string;
  pageId: string | null;
  pageName: string | null;
  tree: ExportDocumentTreeNodeWire;
};

export type ExportDocumentTreeWire = {
  version: 3;
  generatedAt: string;
  fileKey: string;
  fileName: string;
  selectedExportFrameIds: string[];
  summary: {
    exportFrameCount: number;
    nodeCount: number;
    figmaExportTaggedCount: number;
    plannedRasterCount: number;
    rasterizedCount: number;
    truncated: boolean;
    truncateReason: string | null;
    jsonBytes: number;
  };
  /** 仅包含左侧勾选的导出 Frame，每棵 Frame 一棵完整子树 */
  exportFrames: ExportDocumentFrameWire[];
};

export type ExportFrameAnnotationInput = {
  frameNode: FrameNode;
  roles: ReadonlyMap<string, NodeRole>;
  rasterNodeIds: ReadonlySet<string>;
};

export type BuildExportDocumentTreeArgs = {
  generatedAt: string;
  exportFrames: readonly ExportFrameAnnotationInput[];
  auditByNodeId: ReadonlyMap<string, ExportNodeAuditRow>;
  textureAssetRefs: ReadonlySet<string>;
};

type Counters = {
  nodeCount: number;
  tagged: number;
  planned: number;
  truncated: boolean;
  truncateReason: string | null;
};

type SerializeCtx = {
  frameId: string;
  frameName: string;
  roles: ReadonlyMap<string, NodeRole>;
  rasterNodeIds: ReadonlySet<string>;
  auditByNodeId: ReadonlyMap<string, ExportNodeAuditRow>;
  textureAssetRefs: ReadonlySet<string>;
  visited: Set<string>;
};

function overNodeBudget(counters: Counters): boolean {
  if (counters.nodeCount >= DOCUMENT_TREE_MAX_NODES) {
    counters.truncated = true;
    counters.truncateReason = `节点数超过上限 ${DOCUMENT_TREE_MAX_NODES}`;
    return true;
  }
  return false;
}

function serializeSubtreeNode(
  node: SceneNode,
  ctx: SerializeCtx,
  counters: Counters,
  isExportFrameRoot: boolean,
): ExportDocumentTreeNodeWire {
  if (overNodeBudget(counters)) {
    return {
      id: node.id,
      name: node.name,
      type: node.type,
      visible: node.visible !== false,
      width: null,
      height: null,
      hasFigmaExportSettings: false,
      figmaExportFormats: [],
      isExportFrameRoot,
      pluginRole: null,
      rasterize: null,
      plannedRasterExport: false,
      assetRef: null,
      exportedTexture: false,
      spriteId: null,
      exportStatus: null,
      skipReason: null,
      textureGroupId: null,
      truncated: true,
      children: [],
    };
  }

  if (ctx.visited.has(node.id)) {
    counters.nodeCount += 1;
    return {
      id: node.id,
      name: node.name,
      type: node.type,
      visible: node.visible !== false,
      width: null,
      height: null,
      hasFigmaExportSettings: hasFigmaExportSettings(node),
      figmaExportFormats: [],
      isExportFrameRoot,
      pluginRole: null,
      rasterize: null,
      plannedRasterExport: false,
      assetRef: null,
      exportedTexture: false,
      spriteId: null,
      exportStatus: null,
      skipReason: null,
      textureGroupId: null,
      cycleDetected: true,
      children: [],
    };
  }
  ctx.visited.add(node.id);
  counters.nodeCount += 1;

  const hasExport = hasFigmaExportSettings(node);
  if (hasExport) {
    counters.tagged += 1;
  }

  const role = ctx.roles.get(node.id);
  const { pluginRole, rasterize } = roleLabel(role);
  const inRasterList = ctx.rasterNodeIds.has(node.id);
  const plannedRasterExport =
    (pluginRole === 'exportRoot' || pluginRole === 'childExport') && rasterize === true;
  if (plannedRasterExport) {
    counters.planned += 1;
  }

  const audit = ctx.auditByNodeId.get(node.id);
  const assetRef =
    hasExport || plannedRasterExport || inRasterList
      ? exportAssetRefForNodeId(node.id)
      : null;
  const exportedTexture =
    assetRef !== null ? ctx.textureAssetRefs.has(assetRef) : false;
  const dims = nodeDimensions(node);

  const children: ExportDocumentTreeNodeWire[] = [];
  if ('children' in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      children.push(serializeSubtreeNode(child as SceneNode, ctx, counters, false));
      if (counters.truncated) {
        break;
      }
    }
  }

  return {
    id: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible !== false,
    width: dims.width,
    height: dims.height,
    hasFigmaExportSettings: hasExport,
    figmaExportFormats: figmaExportFormats(node),
    isExportFrameRoot,
    pluginRole,
    rasterize,
    plannedRasterExport,
    assetRef,
    exportedTexture,
    spriteId: audit?.spriteId ?? null,
    exportStatus: audit?.status ?? null,
    skipReason: audit?.skipReason ?? null,
    textureGroupId: audit?.groupId ?? null,
    children,
  };
}

export function buildExportDocumentTree(args: BuildExportDocumentTreeArgs): ExportDocumentTreeWire {
  const counters: Counters = {
    nodeCount: 0,
    tagged: 0,
    planned: 0,
    truncated: false,
    truncateReason: null,
  };

  const exportFrames: ExportDocumentFrameWire[] = [];
  const selectedExportFrameIds: string[] = [];

  for (const { frameNode, roles, rasterNodeIds } of args.exportFrames) {
    selectedExportFrameIds.push(frameNode.id);
    const { pageId, pageName } = pageInfoForFrame(frameNode);
    const ctx: SerializeCtx = {
      frameId: frameNode.id,
      frameName: frameNode.name,
      roles,
      rasterNodeIds,
      auditByNodeId: args.auditByNodeId,
      textureAssetRefs: args.textureAssetRefs,
      visited: new Set<string>(),
    };
    const tree = serializeSubtreeNode(
      frameNode as unknown as SceneNode,
      ctx,
      counters,
      true,
    );
    exportFrames.push({
      frameId: frameNode.id,
      frameName: frameNode.name,
      pageId,
      pageName,
      tree,
    });
    if (counters.truncated) {
      break;
    }
  }

  const rasterizedCount = [...args.auditByNodeId.values()].filter(
    (r) => r.status === 'rasterized',
  ).length;

  let fileKey = '';
  let fileName = '';
  try {
    fileKey = figma.fileKey ?? '';
  } catch {
    /* sandbox */
  }
  try {
    fileName = figma.root.name ?? '';
  } catch {
    /* sandbox */
  }

  const docBody = {
    version: 3 as const,
    generatedAt: args.generatedAt,
    fileKey,
    fileName,
    selectedExportFrameIds,
    summary: {
      exportFrameCount: exportFrames.length,
      nodeCount: counters.nodeCount,
      figmaExportTaggedCount: counters.tagged,
      plannedRasterCount: counters.planned,
      rasterizedCount,
      truncated: counters.truncated,
      truncateReason: counters.truncateReason,
      jsonBytes: 0,
    },
    exportFrames,
  };

  const jsonBytes = encodeUtf8(JSON.stringify(docBody)).length;
  docBody.summary.jsonBytes = jsonBytes;

  return docBody;
}

export function serializeExportDocumentTree(doc: ExportDocumentTreeWire): Uint8Array {
  return encodeUtf8(JSON.stringify(doc));
}
