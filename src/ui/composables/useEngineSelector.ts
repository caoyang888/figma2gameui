// src/ui/composables/useEngineSelector.ts
import { computed, ref } from 'vue'
import type { SettingsStatePayload } from '../../types/messages'
import { EXPORT_ENGINE_OPTIONS, type ExportEngineOption } from '../engineOptions'

function normalizeEngineSelection(
  id: string,
  version: string
): { engineId: string; engineVersion: string } {
  if (id === 'cocos-creator-2' && version.startsWith('2.4'))
    return { engineId: 'cocos-creator-2', engineVersion: '2.4.x' }
  if (id === 'unity')
    return { engineId: 'unity', engineVersion: '2019.4.x' }
  if (id === 'cocos-creator-3' && version.startsWith('3.8'))
    return { engineId: 'cocos-creator-3', engineVersion: '3.8.x' }
  return { engineId: id, engineVersion: version }
}

export function useEngineSelector() {
  const engineId = ref('cocos-creator-3')
  const engineVersion = ref('3.8.x')

  function getSelectedEngineOption(): ExportEngineOption | undefined {
    return EXPORT_ENGINE_OPTIONS.find(
      (o) => o.engineId === engineId.value && o.engineVersion === engineVersion.value
    )
  }

  const selectedEngineKey = computed({
    get: () => getSelectedEngineOption()?.key ?? '',
    set: (key: string) => {
      const opt = EXPORT_ENGINE_OPTIONS.find((o) => o.key === key)
      if (!opt || !opt.supported) return
      engineId.value = opt.engineId
      engineVersion.value = opt.engineVersion
    },
  })

  const engineSelectOptions = computed(() =>
    EXPORT_ENGINE_OPTIONS.map((opt) => ({
      value: opt.key,
      label: opt.label,
      disabled: !opt.supported,
    }))
  )

  function hydrate(p: SettingsStatePayload): void {
    const rawId =
      typeof p.engineId === 'string' && p.engineId.trim() !== ''
        ? p.engineId
        : 'cocos-creator-3'
    const rawVersion =
      typeof p.engineVersion === 'string' && p.engineVersion.trim() !== ''
        ? p.engineVersion
        : '3.8.x'
    const n = normalizeEngineSelection(rawId, rawVersion)
    engineId.value = n.engineId
    engineVersion.value = n.engineVersion
  }

  return {
    engineId,
    engineVersion,
    selectedEngineKey,
    engineSelectOptions,
    getSelectedEngineOption,
    hydrate,
  }
}
