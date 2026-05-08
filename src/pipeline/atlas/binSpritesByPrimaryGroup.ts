export type SpriteRefBucket = { primaryGroup: string; assetRefs: string[] };

export function binSpriteRefsByPrimaryGroup(input: {
  assetRefs: readonly string[];
  primaryGroupByAssetRef: ReadonlyMap<string, string>;
}): SpriteRefBucket[] {
  const byGroup = new Map<string, string[]>();

  for (const ref of input.assetRefs) {
    const primaryGroup = input.primaryGroupByAssetRef.get(ref)?.trim() || "";
    let bucket = byGroup.get(primaryGroup);
    if (!bucket) {
      bucket = [];
      byGroup.set(primaryGroup, bucket);
    }
    bucket.push(ref);
  }

  const primaryGroups = [...byGroup.keys()].sort();
  return primaryGroups.map((primaryGroup) => {
    const assetRefs = byGroup.get(primaryGroup)!;
    assetRefs.sort();
    return { primaryGroup, assetRefs };
  });
}
