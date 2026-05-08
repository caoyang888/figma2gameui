import type { IR, IrNode } from '../schema';
import { buildTextureRefCanonicalMap, type TexturePayload } from '../../../shared/hash';

function rewriteSpriteRefsInNodes(nodes: IrNode[], refToCanon: ReadonlyMap<string, string>): void {
  for (const n of nodes) {
    if (n.kind === 'sprite' || n.kind === 'slicedSprite') {
      const canon = refToCanon.get(n.assetRef);
      if (canon !== undefined) {
        n.assetRef = canon;
      }
    }
    if ('children' in n && n.children) {
      rewriteSpriteRefsInNodes(n.children, refToCanon);
    }
  }
}

export type DedupeTexturesResult = {
  /** 合并前贴图条目数 */
  textureEntryCount: number;
  /** 合并后唯一贴图数 */
  uniqueAfter: number;
  /** 被合并掉的重复条目数（等于节省的重复文件数） */
  mergedAway: number;
};

/**
 * 按 PNG 字节内容合并 `textureByAssetRef`，并重写各 Frame IR 中 sprite/slicedSprite 的 assetRef 指向规范 ref。
 */
export async function dedupeTexturesByBytesInPlace(
  ir: IR,
  textureByAssetRef: Map<string, TexturePayload>,
  report: { add(level: 'error' | 'warning' | 'info', message: string, nodeId?: string): void },
): Promise<DedupeTexturesResult> {
  const before = textureByAssetRef.size;
  if (before === 0) {
    return { textureEntryCount: 0, uniqueAfter: 0, mergedAway: 0 };
  }

  const refToCanon = await buildTextureRefCanonicalMap(textureByAssetRef);
  let mergedAway = 0;
  for (const [ref, canon] of refToCanon) {
    if (ref !== canon) {
      mergedAway += 1;
    }
  }

  for (const frame of ir.frames) {
    rewriteSpriteRefsInNodes(frame.children, refToCanon);
  }

  const next = new Map<string, TexturePayload>();
  for (const [ref, payload] of textureByAssetRef) {
    const canon = refToCanon.get(ref) ?? ref;
    if (!next.has(canon)) {
      next.set(canon, payload);
    }
  }
  textureByAssetRef.clear();
  for (const [k, v] of next) {
    textureByAssetRef.set(k, v);
  }

  const uniqueAfter = textureByAssetRef.size;
  if (mergedAway > 0) {
    report.add(
      'info',
      `重复贴图已按 PNG 字节合并：${before} 条栅格条目 → ${uniqueAfter} 个唯一文件（省去 ${mergedAway} 个重复写入）。`,
    );
  }

  return { textureEntryCount: before, uniqueAfter, mergedAway };
}
