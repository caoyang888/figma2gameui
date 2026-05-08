// src/ui/composables/useAtlasSettings.ts
import { computed, ref } from 'vue'
import type { SettingsStatePayload } from '../../types/messages'
import {
  ATLAS_LARGE_SPRITE_AREA_RATIO_DEFAULT,
  ATLAS_MAX_SIDE_POT_OPTIONS,
  atlasMaxSidePotOptionIndex,
  clampAtlasLargeSpriteAreaRatio,
  potOptionIndexToMaxSide,
} from '../../shared/atlasPackSettings'

export const ATLAS_POT_INDEX_MAX = ATLAS_MAX_SIDE_POT_OPTIONS.length - 1

export function useAtlasSettings() {
  const atlasPackingRequested = ref(true)
  const atlasPackingDevUnlock = ref(true)
  const atlasMaxSidePotIndex = ref(
    Math.max(0, ATLAS_MAX_SIDE_POT_OPTIONS.indexOf(2048))
  )
  const atlasLargeSpriteAreaRatio = ref(ATLAS_LARGE_SPRITE_AREA_RATIO_DEFAULT)

  const atlasPackingAuthorized = computed(() => atlasPackingDevUnlock.value)

  const atlasPotMarks = computed(() => {
    const o: Record<number, string> = {}
    for (let i = 0; i < ATLAS_MAX_SIDE_POT_OPTIONS.length; i++) {
      o[i] = String(ATLAS_MAX_SIDE_POT_OPTIONS[i]!)
    }
    return o
  })

  function atlasPotTooltip(val?: number): string {
    if (typeof val !== 'number' || !Number.isFinite(val)) return ''
    return `${potOptionIndexToMaxSide(val)} px`
  }

  function hydrate(p: SettingsStatePayload): void {
    atlasPackingRequested.value = p.atlasPackingRequested === true
    atlasPackingDevUnlock.value = p.atlasPackingDevUnlock === true
    const side =
      typeof p.atlasMaxSide === 'number' && Number.isFinite(p.atlasMaxSide)
        ? p.atlasMaxSide
        : 2048
    atlasMaxSidePotIndex.value = atlasMaxSidePotOptionIndex(side)
    const r =
      typeof p.atlasLargeSpriteAreaRatio === 'number' &&
        Number.isFinite(p.atlasLargeSpriteAreaRatio)
        ? p.atlasLargeSpriteAreaRatio
        : ATLAS_LARGE_SPRITE_AREA_RATIO_DEFAULT
    atlasLargeSpriteAreaRatio.value = clampAtlasLargeSpriteAreaRatio(r)
  }

  return {
    atlasPackingRequested,
    atlasPackingDevUnlock,
    atlasMaxSidePotIndex,
    atlasLargeSpriteAreaRatio,
    atlasPotIndexMax: ATLAS_POT_INDEX_MAX,
    atlasPackingAuthorized,
    atlasPotMarks,
    atlasPotTooltip,
    hydrate,
  }
}
