// src/ui/composables/useFontManager.ts
import { ref } from 'vue'
import type { SettingsStatePayload, ExportFontFileWire } from '../../types/messages'

export function useFontManager() {
  const fontKeys = ref<string[]>([])
  const fontMapState = ref<Record<string, string>>({})
  const fontFileState = ref<Record<string, File>>({})
  const fontUuidMapState = ref<Record<string, string>>({})

  function onFontFileInput(key: string, ev: Event, onFlush: () => void): void {
    const input = ev.target as HTMLInputElement
    const f = input.files?.[0]
    if (!f) {
      fontMapState.value = { ...fontMapState.value, [key]: '' }
      return
    }
    if (!f.name.toLowerCase().endsWith('.ttf')) return
    fontFileState.value = { ...fontFileState.value, [key]: f }
    fontMapState.value = { ...fontMapState.value, [key]: f.name }
    input.value = ''
    onFlush()
  }

  function onFontDrop(key: string, ev: DragEvent, onFlush: () => void): void {
    const file = ev.dataTransfer?.files?.[0]
    if (!file || !file.name.toLowerCase().endsWith('.ttf')) return
    fontFileState.value = { ...fontFileState.value, [key]: file }
    fontMapState.value = { ...fontMapState.value, [key]: file.name }
    onFlush()
  }

  async function buildFontFilesPayload(): Promise<Record<string, ExportFontFileWire>> {
    const fontFiles: Record<string, ExportFontFileWire> = {}
    for (const key of Object.keys(fontMapState.value)) {
      const f = fontFileState.value[key]
      if (!f || !f.name.toLowerCase().endsWith('.ttf')) continue
      const buf = await f.arrayBuffer()
      fontFiles[key] = { fileName: f.name, data: Array.from(new Uint8Array(buf)) }
    }
    return fontFiles
  }

  function hydrate(p: SettingsStatePayload, isFirstHydration: boolean): void {
    const map =
      p.fontMap && typeof p.fontMap === 'object' && !Array.isArray(p.fontMap)
        ? p.fontMap
        : {}
    const fontUuidMap =
      p.fontUuidMap && typeof p.fontUuidMap === 'object' && !Array.isArray(p.fontUuidMap)
        ? p.fontUuidMap
        : {}
    fontMapState.value = { ...map }
    fontUuidMapState.value = { ...fontUuidMap }
    if (isFirstHydration) {
      fontFileState.value = {}
    } else {
      const preserved: Record<string, File> = {}
      for (const [key, file] of Object.entries(fontFileState.value)) {
        const expected = (map[key] || '').trim()
        if (file && expected !== '' && file.name === expected) {
          preserved[key] = file
        }
      }
      fontFileState.value = preserved
    }
  }

  return {
    fontKeys,
    fontMapState,
    fontFileState,
    fontUuidMapState,
    onFontFileInput,
    onFontDrop,
    buildFontFilesPayload,
    hydrate,
  }
}
