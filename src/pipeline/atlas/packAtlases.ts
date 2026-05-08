import type { AtlasLayout, AtlasPage, AtlasSpriteEntry } from '../../domain/atlas/atlasLayout';
import type { IR, IrNode } from '../../domain/ir/schema';
import type { TexturePayload } from '../../shared/hash';
import {
  ATLAS_LARGE_SPRITE_AREA_RATIO_DEFAULT,
  clampAtlasLargeSpriteAreaRatio,
} from '../../shared/atlasPackSettings';
import { binSpriteRefsByPrimaryGroup } from './binSpritesByPrimaryGroup';

export type PackerBucketPort = (input: {
  atlasKey: string;
  sprites: { assetRef: string; bytes: Uint8Array; width: number; height: number }[];
}) => Promise<
  Array<{
    atlasKey: string;
    pngBytes: Uint8Array;
    width: number;
    height: number;
    rects: Map<string, { x: number; y: number; width: number; height: number }>;
  }>
>;

export type PackAtlasesReport = {
  add(level: 'error' | 'warning' | 'info', message: string, nodeId?: string): void;
};

export type PackAtlasesArgs = {
  ir: IR;
  textureByAssetRef: ReadonlyMap<string, TexturePayload>;
  primaryGroupByAssetRef: ReadonlyMap<string, string>;
  atlasMaxSide: number;
  /** 未传时与 {@link ATLAS_LARGE_SPRITE_AREA_RATIO_DEFAULT} 一致。 */
  atlasLargeSpriteAreaRatioThreshold?: number;
  packBucket: PackerBucketPort;
  report: PackAtlasesReport;
};

const SLICED_SPRITE_SKIP_MESSAGE =
  '合图打包已跳过：IR 中存在 slicedSprite（MVP 暂不支持切片精灵合图）。';

function walkHasSlicedSprite(nodes: readonly IrNode[]): boolean {
  for (const n of nodes) {
    if (n.kind === 'slicedSprite') {
      return true;
    }
    if (n.kind === 'container' || n.kind === 'mask') {
      if (walkHasSlicedSprite(n.children)) {
        return true;
      }
    }
  }
  return false;
}

function irHasAnySlicedSprite(ir: IR): boolean {
  for (const f of ir.frames) {
    if (walkHasSlicedSprite(f.children)) {
      return true;
    }
  }
  return false;
}

function collectSpriteAssetRefs(ir: IR): string[] {
  const set = new Set<string>();
  const walk = (nodes: readonly IrNode[]) => {
    for (const n of nodes) {
      if (n.kind === 'sprite') {
        set.add(n.assetRef);
      }
      if (n.kind === 'container' || n.kind === 'mask') {
        walk(n.children);
      }
    }
  };
  for (const f of ir.frames) {
    walk(f.children);
  }
  return [...set].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function atlasTextureKey(atlasKey: string): string {
  return `atlas://${atlasKey}.png`;
}

/**
 * 编排合图：按主分组分桶并调用注入的 `packBucket`；不实现真实光栅化。
 * 若存在 slicedSprite、无输入贴图、或无可打包的 sprite，则返回 `undefined`。
 */
export async function packAtlases(
  args: PackAtlasesArgs,
): Promise<{ layout: AtlasLayout; textureByAssetRef: Map<string, TexturePayload> } | undefined> {
  const { ir, textureByAssetRef, primaryGroupByAssetRef, atlasMaxSide, packBucket, report } = args;
  const largeSpriteAreaRatio = clampAtlasLargeSpriteAreaRatio(
    args.atlasLargeSpriteAreaRatioThreshold ?? ATLAS_LARGE_SPRITE_AREA_RATIO_DEFAULT,
  );

  if (irHasAnySlicedSprite(ir)) {
    report.add('warning', SLICED_SPRITE_SKIP_MESSAGE);
    return undefined;
  }

  if (textureByAssetRef.size === 0) {
    return undefined;
  }

  const spriteAssetRefs = collectSpriteAssetRefs(ir);
  if (spriteAssetRefs.length === 0) {
    return undefined;
  }

  const buckets = binSpriteRefsByPrimaryGroup({
    assetRefs: spriteAssetRefs,
    primaryGroupByAssetRef,
  });

  const pages: AtlasPage[] = [];
  const outTextures = new Map<string, TexturePayload>(textureByAssetRef);
  let atlasOrdinal = 0;

  for (const bucket of buckets) {
    const spritesInput: { assetRef: string; bytes: Uint8Array; width: number; height: number }[] = [];
    for (const ref of bucket.assetRefs) {
      const tex = textureByAssetRef.get(ref);
      if (!tex) {
        continue;
      }
      const sideTooLarge = tex.width > atlasMaxSide || tex.height > atlasMaxSide;
      const areaLarge =
        (tex.width * tex.height) / Math.max(1, atlasMaxSide * atlasMaxSide) >= largeSpriteAreaRatio;
      if (sideTooLarge || areaLarge) {
        report.add('info', `已跳过大图合图，保持散图导出：${ref}（${tex.width}x${tex.height}）`, ref);
        continue;
      }
      spritesInput.push({
        assetRef: ref,
        bytes: tex.bytes,
        width: tex.width,
        height: tex.height,
      });
    }

    if (spritesInput.length === 0) {
      continue;
    }

    const packedPages = await packBucket({ atlasKey: `atlas-${atlasOrdinal}`, sprites: spritesInput });
    atlasOrdinal += packedPages.length;

    for (const packed of packedPages) {
      const atlasSprites: AtlasSpriteEntry[] = [];
      for (const [ref, rect] of packed.rects) {
        atlasSprites.push({
          assetRef: ref,
          rect,
          // Rasterizer currently does not trim, so sourceSize should follow packed rect.
          sourceSize: { width: rect.width, height: rect.height },
        });
      }
      atlasSprites.sort((a, b) => (a.assetRef < b.assetRef ? -1 : a.assetRef > b.assetRef ? 1 : 0));

      const page: AtlasPage = {
        atlasKey: packed.atlasKey,
        pngFileBaseName: `${packed.atlasKey}.png`,
        width: packed.width,
        height: packed.height,
        sprites: atlasSprites,
      };
      pages.push(page);

      outTextures.set(atlasTextureKey(packed.atlasKey), {
        bytes: packed.pngBytes,
        width: packed.width,
        height: packed.height,
      });
    }
  }

  if (pages.length === 0) {
    return undefined;
  }

  const layout: AtlasLayout = { version: 1, pages };
  return { layout, textureByAssetRef: outTextures };
}
