import { describe, it, expect } from "vitest";
import { IR_VERSION, type IR } from "../../src/domain/ir/schema";
import { collectSpriteLikeRefsInIr } from "../../src/pipeline/orchestrator";

describe("collectSpriteLikeRefsInIr", () => {
  it("collects sprite and slicedSprite assetRef, id, and parent frame meta", () => {
    const ir: IR = {
      version: IR_VERSION,
      generatedAt: "",
      sourceFileKey: "",
      frames: [
        {
          id: "f-a",
          name: "FrameA",
          width: 1,
          height: 1,
          assets: [],
          children: [
            {
              kind: "sprite",
              id: "n1:export",
              name: "s",
              placement: { x: 0, y: 0, width: 1, height: 1 },
              opacity: 1,
              visible: true,
              extensions: {},
              assetRef: "export-n1.png",
            },
          ],
        },
        {
          id: "f-b",
          name: "FrameB",
          width: 1,
          height: 1,
          assets: [],
          children: [
            {
              kind: "container",
              id: "c1",
              name: "C",
              placement: { x: 0, y: 0, width: 1, height: 1 },
              opacity: 1,
              visible: true,
              extensions: {},
              children: [
                {
                  kind: "slicedSprite",
                  id: "n2",
                  name: "ss",
                  placement: { x: 0, y: 0, width: 1, height: 1 },
                  opacity: 1,
                  visible: true,
                  extensions: {},
                  assetRef: "export-n2.png",
                  slices: { top: 0, bottom: 0, left: 0, right: 0 },
                },
              ],
            },
          ],
        },
      ],
    };
    const rows = collectSpriteLikeRefsInIr(ir);
    expect(rows).toEqual([
      {
        assetRef: "export-n1.png",
        spriteId: "n1:export",
        frameId: "f-a",
        frameName: "FrameA",
      },
      {
        assetRef: "export-n2.png",
        spriteId: "n2",
        frameId: "f-b",
        frameName: "FrameB",
      },
    ]);
  });
});
