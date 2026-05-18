import { exportAssetRefForNodeId } from "../domain/ir/builder";
import { encodeUtf8 } from "../shared/utf8";

/** Windows / reserved / control chars aligned with existing texture filename sanitization; whitespace → `_`. */
const SLUG_REPLACE = /[\s<>:"/\\|?*\u0000-\u001f]/g;

/**
 * §4.1: trim; empty invalid; replace reserved/control (and whitespace) with `_`;
 * collapse consecutive `_`; trim `_` from ends; empty result is invalid for callers.
 */
export function slugTextureGroupId(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return "";
  }
  const withUnderscores = trimmed.replace(SLUG_REPLACE, "_");
  const collapsed = withUnderscores.replace(/_+/g, "_");
  return collapsed.replace(/^_+|_+$/g, "");
}

export function defaultFrameGroupId(frameName: string, frameNodeId: string): string {
  const idTail = frameNodeId.replace(/:/g, "").slice(-6);
  return `frame-${slugTextureGroupId(frameName)}-${idTail}`;
}

const NAMING_PATTERN = /@g:([^\s@]+)/;

function tryNamingGroupFromName(name: string): string | null {
  const m = NAMING_PATTERN.exec(name);
  if (!m) {
    return null;
  }
  const slugged = slugTextureGroupId(m[1] ?? "");
  return slugged === "" ? null : slugged;
}

/**
 * Check `exportNodeName` first, then each ancestor in order（自下而上；最后一项可为导出 Frame 自身 `name`，见 orchestrator）。
 */
export function parseNamingGroupFromChain(
  exportNodeName: string,
  ancestorNamesUpToFrame: readonly string[],
): string | null {
  const fromSelf = tryNamingGroupFromName(exportNodeName);
  if (fromSelf !== null) {
    return fromSelf;
  }
  for (const n of ancestorNamesUpToFrame) {
    const hit = tryNamingGroupFromName(n);
    if (hit !== null) {
      return hit;
    }
  }
  return null;
}

export type GroupResolution = "frame" | "naming" | "manual";

export function exportNodeIdFromSpriteIr(spriteId: string): string {
  return spriteId.endsWith(":export") ? spriteId.slice(0, -":export".length) : spriteId;
}

export type GroupResolveDetail = {
  groupId: string;
  resolution: GroupResolution;
  /** 命中 `@g:` 的图层名；frame/manual 时为 null */
  namingSourceLayerName: string | null;
  /** 原始 `@g:…` 捕获（未 slug） */
  namingSourceRawTag: string | null;
  manualInput: string | null;
  frameFallbackGroupId: string;
};

function namingSourceFromName(name: string): { layerName: string; rawTag: string } | null {
  const m = NAMING_PATTERN.exec(name);
  if (!m) {
    return null;
  }
  return { layerName: name, rawTag: m[1] ?? "" };
}

export function resolveGroupIdForExportNode(input: {
  exportNodeId: string;
  exportNodeName: string;
  ancestorNamesUpToFrame: readonly string[];
  frameName: string;
  frameId: string;
  manualByExportNodeId?: ReadonlyMap<string, string>;
}): { groupId: string; resolution: GroupResolution } {
  const d = resolveGroupIdForExportNodeDetailed(input);
  return { groupId: d.groupId, resolution: d.resolution };
}

export function resolveGroupIdForExportNodeDetailed(input: {
  exportNodeId: string;
  exportNodeName: string;
  ancestorNamesUpToFrame: readonly string[];
  frameName: string;
  frameId: string;
  manualByExportNodeId?: ReadonlyMap<string, string>;
}): GroupResolveDetail {
  const frameFallbackGroupId = defaultFrameGroupId(input.frameName, input.frameId);

  const manual = input.manualByExportNodeId?.get(input.exportNodeId);
  if (manual !== undefined) {
    const t = manual.trim();
    if (t !== "") {
      const slugged = slugTextureGroupId(t);
      if (slugged !== "") {
        return {
          groupId: slugged,
          resolution: "manual",
          namingSourceLayerName: null,
          namingSourceRawTag: null,
          manualInput: manual,
          frameFallbackGroupId,
        };
      }
    }
  }

  const fromSelf = namingSourceFromName(input.exportNodeName);
  if (fromSelf !== null) {
    const slugged = slugTextureGroupId(fromSelf.rawTag);
    if (slugged !== "") {
      return {
        groupId: slugged,
        resolution: "naming",
        namingSourceLayerName: fromSelf.layerName,
        namingSourceRawTag: fromSelf.rawTag,
        manualInput: null,
        frameFallbackGroupId,
      };
    }
  }

  for (const n of input.ancestorNamesUpToFrame) {
    const fromAncestor = namingSourceFromName(n);
    if (fromAncestor !== null) {
      const slugged = slugTextureGroupId(fromAncestor.rawTag);
      if (slugged !== "") {
        return {
          groupId: slugged,
          resolution: "naming",
          namingSourceLayerName: fromAncestor.layerName,
          namingSourceRawTag: fromAncestor.rawTag,
          manualInput: null,
          frameFallbackGroupId,
        };
      }
    }
  }

  return {
    groupId: frameFallbackGroupId,
    resolution: "frame",
    namingSourceLayerName: null,
    namingSourceRawTag: null,
    manualInput: null,
    frameFallbackGroupId,
  };
}

export type TextureGroupReference = {
  exportNodeId: string;
  exportNodeName: string;
  spriteId: string | null;
  frameId: string;
  frameName: string;
  groupId: string;
  resolution: GroupResolution;
  isPrimaryGroup: boolean;
  ancestorNamesUpToFrame: string[];
  namingSourceLayerName: string | null;
  namingSourceRawTag: string | null;
  manualInput: string | null;
};

export type TextureGroupsEntry = {
  assetRef: string;
  primaryGroup: string;
  groups: string[];
  resolution: GroupResolution;
  references: TextureGroupReference[];
  textureWidth: number | null;
  textureHeight: number | null;
  textureBytes: number | null;
};

export type ExportNodeAuditStatus =
  | "rasterized"
  | "skipped_not_rasterized"
  | "skipped_zero_size"
  | "texture_missing"
  | "no_ir_sprite";

export type ExportNodeAuditRow = {
  frameId: string;
  frameName: string;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  role: string;
  rasterize: boolean;
  assetRef: string;
  exportedTexture: boolean;
  spriteId: string | null;
  groupId: string | null;
  resolution: GroupResolution | null;
  status: ExportNodeAuditStatus;
  skipReason: string | null;
  ancestorNamesUpToFrame: string[];
  namingSourceLayerName: string | null;
  namingSourceRawTag: string | null;
};

export type TextureGroupsDocument = {
  version: 2;
  generatedAt: string;
  policy: "frame_then_naming";
  subdirByPrimaryGroup: boolean;
  summary: {
    frameCount: number;
    textureCount: number;
    exportNodeWithSettingsCount: number;
    rasterizedCount: number;
    textureMissingCount: number;
    noIrSpriteCount: number;
  };
  frames: { frameId: string; frameName: string }[];
  entries: TextureGroupsEntry[];
  exportNodes: ExportNodeAuditRow[];
};

function uniqueSorted(groups: readonly string[]): string[] {
  return [...new Set(groups)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export type TextureGroupsResolveRow = {
  exportNodeId: string;
  exportNodeName: string;
  ancestorNamesUpToFrame: readonly string[];
  frameName: string;
  frameId: string;
  spriteId?: string | null;
};

function skipReasonForExportNode(input: {
  role: string;
  rasterize: boolean;
  exportedTexture: boolean;
  inRasterList: boolean;
  spriteId: string | null;
}): { status: ExportNodeAuditStatus; skipReason: string | null } {
  if (input.role === "label") {
    return {
      status: "skipped_not_rasterized",
      skipReason: "TEXT 位于已导出祖先之下：作为 label 不单独出 PNG",
    };
  }
  if (
    (input.role === "exportRoot" || input.role === "childExport") &&
    !input.rasterize
  ) {
    return {
      status: "skipped_not_rasterized",
      skipReason:
        "有 Export 标记但 rasterize=false（子层 Export 已覆盖，或避免与嵌套 Export 叠图）",
    };
  }
  if (!input.inRasterList) {
    return {
      status: "skipped_not_rasterized",
      skipReason: "未进入 raster 列表（通常因 hidden / 0 尺寸 / 角色为 pruned）",
    };
  }
  if (!input.exportedTexture) {
    return {
      status: "texture_missing",
      skipReason: "已进入 raster 流程但 textureByAssetRef 中无对应 PNG（导出失败或 0 尺寸跳过）",
    };
  }
  if (input.spriteId === null) {
    return {
      status: "no_ir_sprite",
      skipReason: "贴图已生成但 IR 中无 sprite/slicedSprite 引用该 assetRef",
    };
  }
  return { status: "rasterized", skipReason: null };
}

export function buildExportNodeAudit(args: {
  frames: ReadonlyArray<{
    frameId: string;
    frameName: string;
    exportNodes: ReadonlyArray<{
      nodeId: string;
      nodeName: string;
      nodeType: string;
      role: string;
      rasterize: boolean;
      ancestorNamesUpToFrame: readonly string[];
    }>;
    rasterNodeIds: ReadonlySet<string>;
  }>;
  textureAssetRefs: ReadonlySet<string>;
  spriteIdByExportNodeId: ReadonlyMap<string, string>;
  manualByExportNodeId?: ReadonlyMap<string, string>;
}): ExportNodeAuditRow[] {
  const rows: ExportNodeAuditRow[] = [];

  for (const frame of args.frames) {
    for (const node of frame.exportNodes) {
      const assetRef = exportAssetRefForNodeId(node.nodeId);
      const exportedTexture = args.textureAssetRefs.has(assetRef);
      const spriteId = args.spriteIdByExportNodeId.get(node.nodeId) ?? null;
      const inRasterList = frame.rasterNodeIds.has(node.nodeId);

      const groupDetail =
        node.nodeId !== ""
          ? resolveGroupIdForExportNodeDetailed({
              exportNodeId: node.nodeId,
              exportNodeName: node.nodeName,
              ancestorNamesUpToFrame: node.ancestorNamesUpToFrame,
              frameName: frame.frameName,
              frameId: frame.frameId,
              manualByExportNodeId: args.manualByExportNodeId,
            })
          : null;

      const { status, skipReason } = skipReasonForExportNode({
        role: node.role,
        rasterize: node.rasterize,
        exportedTexture,
        inRasterList,
        spriteId,
      });

      rows.push({
        frameId: frame.frameId,
        frameName: frame.frameName,
        nodeId: node.nodeId,
        nodeName: node.nodeName,
        nodeType: node.nodeType,
        role: node.role,
        rasterize: node.rasterize,
        assetRef,
        exportedTexture,
        spriteId,
        groupId: groupDetail?.groupId ?? null,
        resolution: groupDetail?.resolution ?? null,
        status,
        skipReason,
        ancestorNamesUpToFrame: [...node.ancestorNamesUpToFrame],
        namingSourceLayerName: groupDetail?.namingSourceLayerName ?? null,
        namingSourceRawTag: groupDetail?.namingSourceRawTag ?? null,
      });
    }
  }

  rows.sort((a, b) => {
    const fc = a.frameName.localeCompare(b.frameName);
    if (fc !== 0) return fc;
    return a.nodeName.localeCompare(b.nodeName);
  });

  return rows;
}

export function buildTextureGroupsDocument(args: {
  textureAssetRefs: readonly string[];
  subdirByPrimaryGroup: boolean;
  policy: "frame_then_naming";
  generatedAt: string;
  manualByExportNodeId?: ReadonlyMap<string, string>;
  textureMetaByAssetRef?: ReadonlyMap<string, { width: number; height: number; bytes: number }>;
  frames?: ReadonlyArray<{ frameId: string; frameName: string }>;
  exportNodeAudit?: readonly ExportNodeAuditRow[];
  resolveRows: (assetRef: string) => ReadonlyArray<TextureGroupsResolveRow>;
}): TextureGroupsDocument {
  const sortedRefs = [...args.textureAssetRefs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const entries: TextureGroupsEntry[] = [];

  for (const assetRef of sortedRefs) {
    const rows = args.resolveRows(assetRef);
    const references: TextureGroupReference[] = [];
    const meta = args.textureMetaByAssetRef?.get(assetRef);

    for (const row of rows) {
      const detail = resolveGroupIdForExportNodeDetailed({
        exportNodeId: row.exportNodeId,
        exportNodeName: row.exportNodeName,
        ancestorNamesUpToFrame: row.ancestorNamesUpToFrame,
        frameName: row.frameName,
        frameId: row.frameId,
        manualByExportNodeId: args.manualByExportNodeId,
      });
      references.push({
        exportNodeId: row.exportNodeId,
        exportNodeName: row.exportNodeName,
        spriteId: row.spriteId ?? null,
        frameId: row.frameId,
        frameName: row.frameName,
        groupId: detail.groupId,
        resolution: detail.resolution,
        isPrimaryGroup: false,
        ancestorNamesUpToFrame: [...row.ancestorNamesUpToFrame],
        namingSourceLayerName: detail.namingSourceLayerName,
        namingSourceRawTag: detail.namingSourceRawTag,
        manualInput: detail.manualInput,
      });
    }

    references.sort((a, b) => a.exportNodeName.localeCompare(b.exportNodeName));

    const groups = uniqueSorted(references.map((r) => r.groupId));
    const primaryGroup = groups[0] ?? "";
    for (const ref of references) {
      ref.isPrimaryGroup = ref.groupId === primaryGroup;
    }

    let resolutionForPrimary: GroupResolution = "frame";
    const primaryRef = references.find((r) => r.groupId === primaryGroup);
    if (primaryRef) {
      resolutionForPrimary = primaryRef.resolution;
    }

    entries.push({
      assetRef,
      primaryGroup,
      groups,
      resolution: resolutionForPrimary,
      references,
      textureWidth: meta?.width ?? null,
      textureHeight: meta?.height ?? null,
      textureBytes: meta?.bytes ?? null,
    });
  }

  const exportNodes = args.exportNodeAudit ? [...args.exportNodeAudit] : [];
  const rasterizedCount = exportNodes.filter((n) => n.status === "rasterized").length;

  return {
    version: 2,
    generatedAt: args.generatedAt,
    policy: "frame_then_naming",
    subdirByPrimaryGroup: args.subdirByPrimaryGroup,
    summary: {
      frameCount: args.frames?.length ?? 0,
      textureCount: sortedRefs.length,
      exportNodeWithSettingsCount: exportNodes.length,
      rasterizedCount,
      textureMissingCount: exportNodes.filter((n) => n.status === "texture_missing").length,
      noIrSpriteCount: exportNodes.filter((n) => n.status === "no_ir_sprite").length,
    },
    frames: args.frames ? [...args.frames] : [],
    entries,
    exportNodes,
  };
}

export function serializeTextureGroupsDocument(doc: TextureGroupsDocument): Uint8Array {
  return encodeUtf8(JSON.stringify(doc, null, 2));
}
