import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as packAtlasesMod from "../../src/pipeline/atlas/packAtlases";
import { IR_VERSION, type IR } from "../../src/domain/ir/schema";
import type { ExportSettings } from "../../src/pipeline/context";
import { ReportCollector } from "../../src/pipeline/report";
import { resolveTexturesForEmitterAfterTransform } from "../../src/pipeline/orchestrator";
import type { AtlasLayout } from "../../src/domain/atlas/atlasLayout";
import type { TexturePayload } from "../../src/shared/hash";

function baseSettings(overrides: Partial<ExportSettings>): ExportSettings {
  return {
    engineId: "unity",
    engineVersion: "6000.0",
    assetsRootRelative: "_figma_export",
    prefabsRelativeDir: "Prefabs",
    texturesRelativeDir: "Textures",
    fontsRelativeDir: "Fonts",
    includePrefabs: true,
    includeTextures: true,
    includeFonts: false,
    exportConstraintsEnabled: true,
    widgetRootFillScreen: false,
    exportFigmaAutoLayoutEnabled: true,
    attachDebugIr: false,
    textureSubdirByPrimaryGroup: false,
    atlasPackingRequested: false,
    atlasPackingAuthorized: false,
    atlasMaxSide: 2048,
    atlasLargeSpriteAreaRatioThreshold: 0.75,
    fontFiles: new Map(),
    fontUuidOverrides: new Map(),
    engineSpecific: {},
    ...overrides,
  };
}

function minimalSpriteIr(assetRef: string): IR {
  return {
    version: IR_VERSION,
    generatedAt: "2026-04-20T00:00:00.000Z",
    sourceFileKey: "",
    frames: [
      {
        id: "f1",
        name: "F",
        width: 1,
        height: 1,
        assets: [],
        children: [
          {
            kind: "sprite",
            id: "1:1:export",
            name: "s",
            placement: { x: 0, y: 0, width: 1, height: 1 },
            opacity: 1,
            visible: true,
            extensions: {},
            assetRef,
          },
        ],
      },
    ],
  };
}

describe("resolveTexturesForEmitterAfterTransform (atlas wiring)", () => {
  let packSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    packSpy = vi.spyOn(packAtlasesMod, "packAtlases");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not call packAtlases when atlas packing is not requested (atlas-off unchanged)", async () => {
    const assetRef = "export-n1.png";
    const tex = new Map<string, TexturePayload>([
      [assetRef, { bytes: new Uint8Array([137, 80]), width: 1, height: 1 }],
    ]);
    const report = new ReportCollector();
    const out = await resolveTexturesForEmitterAfterTransform({
      settings: baseSettings({
        atlasPackingRequested: false,
        atlasPackingAuthorized: true,
      }),
      transformedIr: minimalSpriteIr(assetRef),
      textureByAssetRef: tex,
      primaryGroupByAssetRef: { [assetRef]: "g1" },
      report,
    });
    expect(packSpy).not.toHaveBeenCalled();
    expect(out.textureByAssetRef).toBe(tex);
    expect(out.atlasLayout).toBeUndefined();
  });

  it("does not call packAtlases when includeTextures is false even if atlas requested+authorized", async () => {
    const assetRef = "export-n1.png";
    const tex = new Map<string, TexturePayload>([
      [assetRef, { bytes: new Uint8Array([137, 80]), width: 1, height: 1 }],
    ]);
    const report = new ReportCollector();
    await resolveTexturesForEmitterAfterTransform({
      settings: baseSettings({
        atlasPackingRequested: true,
        atlasPackingAuthorized: true,
        includeTextures: false,
      }),
      transformedIr: minimalSpriteIr(assetRef),
      textureByAssetRef: tex,
      primaryGroupByAssetRef: { [assetRef]: "g1" },
      report,
    });
    expect(packSpy).not.toHaveBeenCalled();
  });

  it("when atlas enabled+authorized and pack succeeds, returns atlas texture map, layout, and info report", async () => {
    const assetRef = "export-n1.png";
    const originalTex = new Map<string, TexturePayload>([
      [assetRef, { bytes: new Uint8Array([137, 80, 78, 71]), width: 1, height: 1 }],
    ]);
    const packedTex = new Map<string, TexturePayload>([
      ["atlas://atlas-0.png", { bytes: new Uint8Array([1, 2, 3]), width: 4, height: 4 }],
    ]);
    const layout: AtlasLayout = {
      version: 1,
      pages: [
        {
          atlasKey: "atlas-0",
          pngFileBaseName: "atlas-0.png",
          width: 4,
          height: 4,
          sprites: [
            {
              assetRef,
              rect: { x: 0, y: 0, width: 1, height: 1 },
              sourceSize: { width: 1, height: 1 },
            },
          ],
        },
      ],
    };
    packSpy.mockResolvedValue({ layout, textureByAssetRef: packedTex });

    const report = new ReportCollector();
    const out = await resolveTexturesForEmitterAfterTransform({
      settings: baseSettings({
        atlasPackingRequested: true,
        atlasPackingAuthorized: true,
        includeTextures: true,
      }),
      transformedIr: minimalSpriteIr(assetRef),
      textureByAssetRef: originalTex,
      primaryGroupByAssetRef: { [assetRef]: "shop" },
      report,
    });

    expect(packSpy).toHaveBeenCalledTimes(1);
    const call = packSpy.mock.calls[0]![0]!;
    expect(call.ir).toBeDefined();
    expect(call.primaryGroupByAssetRef.get(assetRef)).toBe("shop");

    expect(out.textureByAssetRef).toBe(packedTex);
    expect(out.atlasLayout).toEqual(layout);

    const infos = report.getEntries().filter((e) => e.level === "info");
    expect(infos.some((e) => e.message === "图集合图：共 1 张 atlas 页。")).toBe(true);
  });

  it("falls back to original textures when packAtlases throws", async () => {
    const assetRef = "export-n1.png";
    const originalTex = new Map<string, TexturePayload>([
      [assetRef, { bytes: new Uint8Array([137, 80, 78, 71]), width: 1, height: 1 }],
    ]);
    packSpy.mockRejectedValue(new Error("mock pack failure"));

    const report = new ReportCollector();
    const out = await resolveTexturesForEmitterAfterTransform({
      settings: baseSettings({
        atlasPackingRequested: true,
        atlasPackingAuthorized: true,
        includeTextures: true,
      }),
      transformedIr: minimalSpriteIr(assetRef),
      textureByAssetRef: originalTex,
      primaryGroupByAssetRef: { [assetRef]: "shop" },
      report,
    });

    expect(out.textureByAssetRef).toBe(originalTex);
    expect(out.atlasLayout).toBeUndefined();

    const warns = report.getEntries().filter((e) => e.level === "warning");
    expect(
      warns.some((e) =>
        e.message.startsWith("图集打包失败，已回退为散图导出：mock pack failure"),
      ),
    ).toBe(true);
  });
});
