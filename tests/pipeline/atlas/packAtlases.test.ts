import { describe, it, expect, vi } from "vitest";
import { IR_VERSION, type IR, type IrSlicedSprite, type IrSprite } from "../../../src/domain/ir/schema";
import { packAtlases, type PackerBucketPort } from "../../../src/pipeline/atlas/packAtlases";

const baseFrame = {
  id: "f1",
  name: "F",
  width: 100,
  height: 100,
  children: [] as (IrSprite | IrSlicedSprite)[],
  assets: [],
};

function minimalIr(children: (IrSprite | IrSlicedSprite)[]): IR {
  return {
    version: IR_VERSION,
    generatedAt: "2026-04-20T00:00:00Z",
    sourceFileKey: "test",
    frames: [{ ...baseFrame, children }],
  };
}

const sprite = (id: string, assetRef: string): IrSprite => ({
  kind: "sprite",
  id,
  name: id,
  placement: { x: 0, y: 0, width: 10, height: 10 },
  opacity: 1,
  visible: true,
  extensions: {},
  assetRef,
});

describe("packAtlases", () => {
  it("returns undefined when IR has a slicedSprite and does not call packBucket", async () => {
    const sliced: IrSlicedSprite = {
      kind: "slicedSprite",
      id: "ss",
      name: "ss",
      placement: { x: 0, y: 0, width: 10, height: 10 },
      opacity: 1,
      visible: true,
      extensions: {},
      assetRef: "tex-a",
      slices: { top: 1, bottom: 1, left: 1, right: 1 },
    };
    const ir = minimalIr([sliced]);
    const packBucket = vi.fn<PackerBucketPort>();
    const report = { add: vi.fn() };

    const out = await packAtlases({
      ir,
      textureByAssetRef: new Map([
        ["tex-a", { bytes: new Uint8Array([137]), width: 1, height: 1 }],
      ]),
      primaryGroupByAssetRef: new Map([["tex-a", "g"]]),
      atlasMaxSide: 2048,
      packBucket,
      report,
    });

    expect(out).toBeUndefined();
    expect(packBucket).not.toHaveBeenCalled();
    expect(report.add).toHaveBeenCalledTimes(1);
    expect(report.add).toHaveBeenCalledWith(
      "warning",
      "合图打包已跳过：IR 中存在 slicedSprite（MVP 暂不支持切片精灵合图）。",
    );
  });

  it("fake packer: two sprites in one bucket yields one atlas page and map only atlas texture keys", async () => {
    const ir = minimalIr([sprite("s1", "tex-a"), sprite("s2", "tex-b")]);
    const texA = { bytes: new Uint8Array([1]), width: 2, height: 3 };
    const texB = { bytes: new Uint8Array([2]), width: 4, height: 5 };
    const rects = new Map([
      ["tex-a", { x: 0, y: 0, width: 2, height: 3 }],
      ["tex-b", { x: 2, y: 0, width: 4, height: 5 }],
    ]);
    const pngBytes = new Uint8Array([137, 80, 78, 71]);

    const packBucket = vi.fn<PackerBucketPort>().mockImplementation(async ({ atlasKey, sprites }) => {
      expect(atlasKey).toBe("atlas-0");
      expect(sprites.map((s) => s.assetRef)).toEqual(["tex-a", "tex-b"]);
      return [{ atlasKey: "atlas-0-0", pngBytes, width: 10, height: 20, rects }];
    });

    const out = await packAtlases({
      ir,
      textureByAssetRef: new Map([
        ["tex-a", texA],
        ["tex-b", texB],
      ]),
      primaryGroupByAssetRef: new Map([
        ["tex-a", "shop"],
        ["tex-b", "shop"],
      ]),
      atlasMaxSide: 2048,
      packBucket,
      report: { add: vi.fn() },
    });

    expect(out).toBeDefined();
    expect(out!.layout.version).toBe(1);
    expect(out!.layout.pages).toHaveLength(1);
    const page = out!.layout.pages[0]!;
    expect(page.atlasKey).toBe("atlas-0-0");
    expect(page.pngFileBaseName).toBe("atlas-0-0.png");
    expect(page.width).toBe(10);
    expect(page.height).toBe(20);
    expect(page.sprites).toEqual([
      {
        assetRef: "tex-a",
        rect: { x: 0, y: 0, width: 2, height: 3 },
        sourceSize: { width: 2, height: 3 },
      },
      {
        assetRef: "tex-b",
        rect: { x: 2, y: 0, width: 4, height: 5 },
        sourceSize: { width: 4, height: 5 },
      },
    ]);

    expect([...out!.textureByAssetRef.keys()].sort()).toEqual([
      "atlas://atlas-0-0.png",
      "tex-a",
      "tex-b",
    ]);
    expect(out!.textureByAssetRef.get("atlas://atlas-0-0.png")).toEqual({
      bytes: pngBytes,
      width: 10,
      height: 20,
    });
    expect(packBucket).toHaveBeenCalledTimes(1);
  });

  it("does not skip sprites solely because max(width,height) >= 1024 when still under atlasMaxSide", async () => {
    const ir = minimalIr([sprite("s1", "wide")]);
    const packBucket = vi.fn<PackerBucketPort>().mockImplementation(async ({ sprites }) => {
      expect(sprites).toHaveLength(1);
      expect(sprites[0]?.assetRef).toBe("wide");
      return [
        {
          atlasKey: "atlas-0-0",
          pngBytes: new Uint8Array([137]),
          width: 1024,
          height: 512,
          rects: new Map([["wide", { x: 0, y: 0, width: 1024, height: 512 }]]),
        },
      ];
    });
    const out = await packAtlases({
      ir,
      textureByAssetRef: new Map([
        ["wide", { bytes: new Uint8Array([1]), width: 1024, height: 512 }],
      ]),
      primaryGroupByAssetRef: new Map([["wide", "g"]]),
      atlasMaxSide: 2048,
      packBucket,
      report: { add: vi.fn() },
    });
    expect(out).toBeDefined();
    expect(packBucket).toHaveBeenCalledTimes(1);
  });

  it("atlas keys follow deterministic primary-group bucket order", async () => {
    const ir = minimalIr([sprite("s1", "r-zebra"), sprite("s2", "r-alpha")]);
    const calls: { atlasKey: string; refs: string[] }[] = [];

    const packBucket = vi.fn<PackerBucketPort>().mockImplementation(async ({ atlasKey, sprites }) => {
      calls.push({ atlasKey, refs: sprites.map((s) => s.assetRef) });
      const w = 4;
      const h = 4;
      const rects = new Map(
        sprites.map((s, i) => [s.assetRef, { x: i * 2, y: 0, width: 2, height: 2 }] as const),
      );
      return [
        {
          atlasKey: `${atlasKey}-0`,
          pngBytes: new Uint8Array([atlasKey === "atlas-0" ? 10 : 11]),
          width: w,
          height: h,
          rects,
        },
      ];
    });

    await packAtlases({
      ir,
      textureByAssetRef: new Map([
        ["r-zebra", { bytes: new Uint8Array([1]), width: 2, height: 2 }],
        ["r-alpha", { bytes: new Uint8Array([2]), width: 2, height: 2 }],
      ]),
      primaryGroupByAssetRef: new Map([
        ["r-zebra", "zebra"],
        ["r-alpha", "alpha"],
      ]),
      atlasMaxSide: 2048,
      packBucket,
      report: { add: vi.fn() },
    });

    expect(calls).toEqual([
      { atlasKey: "atlas-0", refs: ["r-alpha"] },
      { atlasKey: "atlas-1", refs: ["r-zebra"] },
    ]);
  });
});
