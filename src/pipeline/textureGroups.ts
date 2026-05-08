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

export function resolveGroupIdForExportNode(input: {
  exportNodeId: string;
  exportNodeName: string;
  ancestorNamesUpToFrame: readonly string[];
  frameName: string;
  frameId: string;
  manualByExportNodeId?: ReadonlyMap<string, string>;
}): { groupId: string; resolution: GroupResolution } {
  const manual = input.manualByExportNodeId?.get(input.exportNodeId);
  if (manual !== undefined) {
    const t = manual.trim();
    if (t !== "") {
      const slugged = slugTextureGroupId(t);
      if (slugged !== "") {
        return { groupId: slugged, resolution: "manual" };
      }
    }
  }

  const naming = parseNamingGroupFromChain(input.exportNodeName, input.ancestorNamesUpToFrame);
  if (naming !== null) {
    return { groupId: naming, resolution: "naming" };
  }

  return {
    groupId: defaultFrameGroupId(input.frameName, input.frameId),
    resolution: "frame",
  };
}

export type TextureGroupsEntry = {
  assetRef: string;
  primaryGroup: string;
  groups: string[];
  resolution: GroupResolution;
};

export type TextureGroupsDocument = {
  version: 1;
  generatedAt: string;
  policy: "frame_then_naming";
  subdirByPrimaryGroup: boolean;
  entries: TextureGroupsEntry[];
};

function uniqueSorted(groups: readonly string[]): string[] {
  return [...new Set(groups)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function buildTextureGroupsDocument(args: {
  textureAssetRefs: readonly string[];
  subdirByPrimaryGroup: boolean;
  policy: "frame_then_naming";
  generatedAt: string;
  manualByExportNodeId?: ReadonlyMap<string, string>;
  resolveRows: (
    assetRef: string,
  ) => ReadonlyArray<{
    exportNodeId: string;
    exportNodeName: string;
    ancestorNamesUpToFrame: readonly string[];
    frameName: string;
    frameId: string;
  }>;
}): TextureGroupsDocument {
  const sortedRefs = [...args.textureAssetRefs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const entries: TextureGroupsEntry[] = [];

  for (const assetRef of sortedRefs) {
    const rows = args.resolveRows(assetRef);
    const resolutions: GroupResolution[] = [];
    const groupIds: string[] = [];

    for (const row of rows) {
      const { groupId, resolution } = resolveGroupIdForExportNode({
        ...row,
        manualByExportNodeId: args.manualByExportNodeId,
      });
      groupIds.push(groupId);
      resolutions.push(resolution);
    }

    const groups = uniqueSorted(groupIds);
    const primaryGroup = groups[0] ?? "";

    let resolutionForPrimary: GroupResolution = "frame";
    const idx = groupIds.findIndex((g) => g === primaryGroup);
    if (idx >= 0) {
      resolutionForPrimary = resolutions[idx] ?? "frame";
    }

    entries.push({
      assetRef,
      primaryGroup,
      groups,
      resolution: resolutionForPrimary,
    });
  }

  return {
    version: 1,
    generatedAt: args.generatedAt,
    policy: "frame_then_naming",
    subdirByPrimaryGroup: args.subdirByPrimaryGroup,
    entries,
  };
}

export function serializeTextureGroupsDocument(doc: TextureGroupsDocument): Uint8Array {
  return encodeUtf8(JSON.stringify(doc, null, 2));
}
