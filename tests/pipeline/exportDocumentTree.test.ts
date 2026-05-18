import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildExportDocumentTree,
  DOCUMENT_TREE_MAX_NODES,
} from "../../src/pipeline/exportDocumentTree";
import type { NodeRole } from "../../src/domain/discovery/annotate";

describe("exportDocumentTree", () => {
  const frame = {
    type: "FRAME",
    id: "1:100",
    name: "Screen",
    visible: true,
    width: 1080,
    height: 1920,
    exportSettings: [],
    parent: { type: "PAGE", id: "0:1", name: "Page 1", parent: null },
    children: [] as unknown[],
  };
  const icon = {
    type: "RECTANGLE",
    id: "1:101",
    name: "Icon",
    visible: true,
    width: 64,
    height: 64,
    exportSettings: [{ format: "PNG" }],
    parent: frame,
    children: [],
  };
  frame.children = [icon];

  beforeEach(() => {
    vi.stubGlobal("figma", {
      fileKey: "fk",
      root: { name: "Test File", children: [] },
    });
  });

  it("only serializes selected export frame subtrees (not whole file)", () => {
    const roles = new Map<string, NodeRole>([
      ["1:100", { role: "passthrough" }],
      ["1:101", { role: "exportRoot", rasterize: true }],
    ]);
    const doc = buildExportDocumentTree({
      generatedAt: "2026-04-18T00:00:00.000Z",
      exportFrames: [
        {
          frameNode: frame as unknown as FrameNode,
          roles,
          rasterNodeIds: new Set(["1:101"]),
        },
      ],
      auditByNodeId: new Map([
        [
          "1:101",
          {
            frameId: "1:100",
            frameName: "Screen",
            nodeId: "1:101",
            nodeName: "Icon",
            nodeType: "RECTANGLE",
            role: "exportRoot",
            rasterize: true,
            assetRef: "export-1-101.png",
            exportedTexture: true,
            spriteId: "1:101:export",
            groupId: "frame-Screen-1100",
            resolution: "frame",
            status: "rasterized",
            skipReason: null,
            ancestorNamesUpToFrame: [],
            namingSourceLayerName: null,
            namingSourceRawTag: null,
          },
        ],
      ]),
      textureAssetRefs: new Set(["export-1-101.png"]),
    });

    expect(doc.version).toBe(3);
    expect(doc.exportFrames).toHaveLength(1);
    expect(doc.exportFrames[0].frameId).toBe("1:100");
    expect(doc.exportFrames[0].pageName).toBe("Page 1");
    expect(doc.exportFrames[0].tree.isExportFrameRoot).toBe(true);
    expect(doc.exportFrames[0].tree.children[0].pluginRole).toBe("exportRoot");
    expect(doc.exportFrames[0].tree.children[0].exportStatus).toBe("rasterized");
    expect(doc.summary.exportFrameCount).toBe(1);
    expect(doc.summary.nodeCount).toBe(2);
    expect("pages" in doc).toBe(false);
  });

  it("truncates when a single frame subtree exceeds node budget", () => {
    const wideFrame = {
      type: "FRAME",
      id: "1:100",
      name: "Root",
      visible: true,
      exportSettings: [],
      parent: null,
      children: Array.from({ length: DOCUMENT_TREE_MAX_NODES + 5 }, (_, i) => ({
        type: "RECTANGLE",
        id: `n:${i}`,
        name: `N${i}`,
        visible: true,
        exportSettings: [],
        children: [],
      })),
    };

    const doc = buildExportDocumentTree({
      generatedAt: "t",
      exportFrames: [
        {
          frameNode: wideFrame as unknown as FrameNode,
          roles: new Map(),
          rasterNodeIds: new Set(),
        },
      ],
      auditByNodeId: new Map(),
      textureAssetRefs: new Set(),
    });

    expect(doc.summary.truncated).toBe(true);
    expect(doc.summary.nodeCount).toBeLessThanOrEqual(DOCUMENT_TREE_MAX_NODES + 1);
  });
});
