import { describe, it, expect } from "vitest";
import { binSpriteRefsByPrimaryGroup } from "../../../src/pipeline/atlas/binSpritesByPrimaryGroup";

describe("binSpriteRefsByPrimaryGroup", () => {
  it("sorts buckets by primaryGroup lexicographically ascending", () => {
    const result = binSpriteRefsByPrimaryGroup({
      assetRefs: ["r-zebra", "r-alpha", "r-mid"],
      primaryGroupByAssetRef: new Map([
        ["r-zebra", "zebra"],
        ["r-alpha", "alpha"],
        ["r-mid", "mid"],
      ]),
    });

    expect(result.map((b) => b.primaryGroup)).toEqual(["alpha", "mid", "zebra"]);
  });

  it("sorts assetRefs within each bucket lexicographically ascending", () => {
    const result = binSpriteRefsByPrimaryGroup({
      assetRefs: ["z", "a", "m"],
      primaryGroupByAssetRef: new Map([
        ["z", "g"],
        ["a", "g"],
        ["m", "g"],
      ]),
    });

    expect(result).toEqual([{ primaryGroup: "g", assetRefs: ["a", "m", "z"] }]);
  });

  it("uses empty string bucket when ref has no primary group (missing map entry)", () => {
    const result = binSpriteRefsByPrimaryGroup({
      assetRefs: ["known", "orphan"],
      primaryGroupByAssetRef: new Map([["known", "shop"]]),
    });

    expect(result).toEqual([
      { primaryGroup: "", assetRefs: ["orphan"] },
      { primaryGroup: "shop", assetRefs: ["known"] },
    ]);
  });

  it("treats whitespace-only primary group as empty string bucket", () => {
    const result = binSpriteRefsByPrimaryGroup({
      assetRefs: ["ws"],
      primaryGroupByAssetRef: new Map([["ws", "   "]]),
    });

    expect(result).toEqual([{ primaryGroup: "", assetRefs: ["ws"] }]);
  });
});
