export const messagesEn = {
  'lang.label': 'Language',
  'lang.option.auto': 'Auto (follow system)',
  'lang.option.en': 'English',
  'lang.option.zhHans': 'Simplified Chinese',
  'lang.option.zhHant': 'Traditional Chinese',
  'conn.connecting': 'Connecting…',
  'conn.connected': 'Connected',
  'validation.heading': 'Export target validation',
  'validation.idleTitle': 'Not validated yet',
  'validation.completedWithErrorsTitle': 'Completed (with errors)',
  'validation.okTitle': 'Validation passed',
  'validation.badTitleGeneric': 'Validation failed',
  'validation.badDetailFromReport': 'See the first error in the report.',
  'validation.badDetailNoEntries':
    'Export finished with failure but no error lines were returned. Try re-selecting Frames on the left.',
  'validation.okDetail': 'You can run export.',
  'validation.exportBlockedTitle': 'Export prerequisites not met',
  'export.err.needKind':
    'Select at least one export kind (prefabs / textures / fonts).',
  'export.err.needFrame':
    'Select at least one Frame to export in the left panel.',
  'export.err.unsupportedEngine': 'Unsupported export target: {engine}',
  'export.err.needFontFiles':
    'Fonts export is enabled; choose a .ttf for every document font ({count} missing).',
  'export.progress.prepare': 'Preparing export…',
  'export.footer.zip': 'Export ZIP',
  'report.title': 'Report',
  'report.empty': 'No entries yet',
  'dev.title': 'Extensions (Developer)',
  'dev.toggleHint': 'Press Ctrl+Shift+D to show or hide this section.',
  'dev.attachDebugIr': 'Include debug IR',
  'dev.atlasUnlock':
    'Atlas packing dev unlock (persisted locally; for debugging before an official license)',
  'layout.title': 'Layout export',
  'layout.exportWidgets': 'Export Widget components',
  'layout.widgetRootFillScreen':
    'Auto-add root Widget: stretch to fill parent (margins 0)',
  'layout.textureSubdir':
    'Subdirectory by primary group (textures/group name/…)',
  'path.summaryLabel': 'Export paths',
  'path.rootHint': 'Export root path (relative to assets)',
  'path.prefabLabel': 'Prefab path (relative to root)',
  'path.exportPrefabs': 'Export prefabs',
  'path.textureLabel': 'Texture path (relative to root)',
  'path.exportTextures': 'Export textures',
  'path.fontLabel': 'Font path (relative to root; reserved)',
  'path.exportFonts': 'Export fonts',
  'path.previewColon': 'Preview:',
  'path.atlasSectionLabel': 'Atlas packing (experimental)',
  'path.atlasUnauthorizedHint':
    'Not authorized: enable “Atlas packing dev unlock” under Extensions (Developer) below.\nPress Ctrl+Shift+D to show that section.',
  'path.atlasPackCheckbox':
    'Pack into atlas; single images whose largest side exceeds ~90% of the max side are excluded from the atlas',
  'font.title': 'Font mapping',
  'font.hint':
    'Fonts used by the subtree of checked Frames for export (click to pick or drop a .ttf)',
  'font.selectedPrefix': 'Selected: {name}',
  'frameTree.title': 'Pages / Layers / Frames',
  'frameTree.empty': 'No pages or Frames to display',
} as const

export type MessageKey = keyof typeof messagesEn
