import { describe, it, expect } from "vitest";
import {
  buildTextureGroupsDocument,
  defaultFrameGroupId,
  exportNodeIdFromSpriteIr,
  parseNamingGroupFromChain,
  resolveGroupIdForExportNode,
  slugTextureGroupId,
} from "../../src/pipeline/textureGroups";

describe("textureGroups", () => {
  it("slugTextureGroupId trims, maps slashes and spaces to underscores, collapses", () => {
    expect(slugTextureGroupId("  Shop / UI  ")).toBe("Shop_UI");
  });

  it("defaultFrameGroupId uses slugged frame name and last 6 chars of id without colons", () => {
    expect(defaultFrameGroupId("Main", "12:3456")).toBe("frame-Main-123456");
  });

  it("parseNamingGroupFromChain reads @g: from export node before ancestors", () => {
    expect(parseNamingGroupFromChain("Icon@g:shop", ["Row", "Root"])).toBe("shop");
  });

  it("resolveGroupIdForExportNode: manual map wins; naming wins over frame; frame fallback", () => {
    const frameRow = {
      exportNodeId: "1:2",
      exportNodeName: "Plain",
      ancestorNamesUpToFrame: [],
      frameName: "F",
      frameId: "0:999",
    };
    expect(resolveGroupIdForExportNode(frameRow)).toEqual({
      groupId: "frame-F-0999",
      resolution: "frame",
    });

    expect(
      resolveGroupIdForExportNode({
        ...frameRow,
        exportNodeName: "Icon@g:shop",
      }),
    ).toEqual({ groupId: "shop", resolution: "naming" });

    expect(
      resolveGroupIdForExportNode({
        ...frameRow,
        exportNodeName: "Icon@g:shop",
        manualByExportNodeId: new Map([["1:2", "  manual_group  "]]),
      }),
    ).toEqual({ groupId: "manual_group", resolution: "manual" });
  });

  it("exportNodeIdFromSpriteIr strips :export suffix", () => {
    expect(exportNodeIdFromSpriteIr("abc:123:export")).toBe("abc:123");
    expect(exportNodeIdFromSpriteIr("abc:123")).toBe("abc:123");
  });

  it("buildTextureGroupsDocument merges groups, sorts, primary is lexicographically first", () => {
    const doc = buildTextureGroupsDocument({
      textureAssetRefs: ["tex/a"],
      subdirByPrimaryGroup: false,
      policy: "frame_then_naming",
      generatedAt: "2026-04-18T00:00:00.000Z",
      resolveRows: () => [
        {
          exportNodeId: "1:1",
          exportNodeName: "Icon@g:zebra",
          ancestorNamesUpToFrame: [],
          frameName: "F1",
          frameId: "0:100",
        },
        {
          exportNodeId: "1:2",
          exportNodeName: "Icon@g:alpha",
          ancestorNamesUpToFrame: [],
          frameName: "F2",
          frameId: "0:200",
        },
      ],
    });
    expect(doc.entries).toHaveLength(1);
    expect(doc.entries[0].groups).toEqual(["alpha", "zebra"]);
    expect(doc.entries[0].primaryGroup).toBe("alpha");
  });

  it("buildTextureGroupsDocument passes manualByExportNodeId into resolution", () => {
    const doc = buildTextureGroupsDocument({
      textureAssetRefs: ["tex/a"],
      subdirByPrimaryGroup: false,
      policy: "frame_then_naming",
      generatedAt: "2026-04-18T00:00:00.000Z",
      manualByExportNodeId: new Map([["1:1", "from_manual"]]),
      resolveRows: () => [
        {
          exportNodeId: "1:1",
          exportNodeName: "Icon@g:ignored",
          ancestorNamesUpToFrame: [],
          frameName: "F",
          frameId: "0:100",
        },
      ],
    });
    expect(doc.entries[0].primaryGroup).toBe("from_manual");
    expect(doc.entries[0].resolution).toBe("manual");
  });
});
