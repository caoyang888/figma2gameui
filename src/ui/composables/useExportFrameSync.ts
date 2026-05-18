// src/ui/composables/useExportFrameSync.ts
import { watch, type Ref } from 'vue'

type Deps = {
  selectedFrameIds: Ref<string[]>
  sendToMain: (payload: unknown) => void
}

/**
 * 将 UI 勾选的 Frame id 同步到主线程（带防抖）。
 * 独立于 useMessaging / useExportOrchestrator，避免 App.vue 初始化顺序 TDZ。
 */
export function useExportFrameSync(deps: Deps) {
  const { selectedFrameIds, sendToMain } = deps

  let frameUpdateTimer: ReturnType<typeof setTimeout> | null = null

  function flushExportFrameIdsSync(ids?: readonly string[]): void {
    if (frameUpdateTimer !== null) {
      clearTimeout(frameUpdateTimer)
      frameUpdateTimer = null
    }
    const next = ids !== undefined ? [...ids] : [...selectedFrameIds.value]
    sendToMain({
      type: 'UPDATE_EXPORT_FRAMES',
      payload: { selectedFrameIds: next },
    })
  }

  function bindFrameSelectionWatch(suppressSave: Ref<boolean>): void {
    watch(
      selectedFrameIds,
      (ids) => {
        if (suppressSave.value) return
        if (frameUpdateTimer !== null) clearTimeout(frameUpdateTimer)
        frameUpdateTimer = setTimeout(() => {
          frameUpdateTimer = null
          flushExportFrameIdsSync(ids)
        }, 80)
      },
      { deep: true },
    )
  }

  return { flushExportFrameIdsSync, bindFrameSelectionWatch }
}
