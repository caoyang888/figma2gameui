import { ReportCollector } from '../../pipeline/report';

/** Default when the node has no image export preset or no explicit constraint. */
const DEFAULT_PNG_CONSTRAINT: { type: 'SCALE'; value: number } = { type: 'SCALE', value: 1 };

/**
 * Reads {@link ExportMixin.exportSettings}[0]. When multiple presets exist, only the
 * first is used (same order as in the Figma export panel); additional entries are ignored.
 * For non-image formats (SVG, PDF, …) the first slot carries no usable PNG constraint; returns `undefined`.
 */
export function getPreferredExportConstraint(
  node: SceneNode & ExportMixin,
): ExportSettings['constraint'] | { type: 'SCALE'; value: number } {
  const exportSettings =
    'exportSettings' in node && Array.isArray(node.exportSettings) ? node.exportSettings : [];
  if (exportSettings.length === 0) {
    return undefined;
  }
  const first = exportSettings[0];
  if (!first || typeof first !== 'object' || !('format' in first)) {
    return undefined;
  }
  if (first.format !== 'PNG' && first.format !== 'JPG') {
    return undefined;
  }
  return 'constraint' in first ? first.constraint : undefined;
}

function resolvedPngConstraint(node: SceneNode & ExportMixin): { type: 'SCALE' | 'WIDTH' | 'HEIGHT'; value: number } {
  return getPreferredExportConstraint(node) ?? DEFAULT_PNG_CONSTRAINT;
}

export async function exportPngBytes(node: SceneNode & ExportMixin): Promise<Uint8Array> {
  const constraint = resolvedPngConstraint(node);
  return node.exportAsync({ format: 'PNG', constraint });
}

function hasExportAsync(node: SceneNode): node is SceneNode & ExportMixin {
  return 'exportAsync' in node && typeof (node as ExportMixin).exportAsync === 'function';
}

export async function tryExportPng(node: SceneNode, report: ReportCollector): Promise<Uint8Array | undefined> {
  if (!hasExportAsync(node)) {
    report.add('error', 'Node does not support raster export (missing exportAsync).', node.id);
    return undefined;
  }
  try {
    return await exportPngBytes(node);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    report.add('error', `PNG export failed: ${message}`, node.id);
    return undefined;
  }
}

/**
 * Entry point for the future full export pipeline: resolve PNG bytes for one scene node
 * with errors captured into {@link ReportCollector}.
 */
export async function buildRasterForExportNode(
  node: SceneNode,
  report: ReportCollector,
): Promise<Uint8Array | undefined> {
  return tryExportPng(node, report);
}
