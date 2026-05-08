function hasNonEmptyExportSettings(node: SceneNode): boolean {
  if (!('exportSettings' in node)) {
    return false;
  }
  const settings = node.exportSettings;
  return Array.isArray(settings) && settings.length > 0;
}

function isVisibleInHierarchy(node: SceneNode): boolean {
  let current: BaseNode | null = node;
  while (current) {
    if ('visible' in current && current.visible === false) {
      return false;
    }
    current = current.parent;
  }
  return true;
}

function walkSceneSubtree(node: SceneNode, out: SceneNode[]): void {
  if (isVisibleInHierarchy(node) && hasNonEmptyExportSettings(node)) {
    out.push(node);
  }
  if ('children' in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      walkSceneSubtree(child, out);
    }
  }
}

/** Depth-first preorder: nodes under `frame` (including the frame) that have native Export settings. */
export function discoverExportNodesInFrame(frame: FrameNode): SceneNode[] {
  const out: SceneNode[] = [];
  walkSceneSubtree(frame, out);
  return out;
}

/**
 * Keep only top-level export roots: if an export node has an export-marked ancestor
 * in the same set, it is filtered out to avoid duplicate subtree export.
 */
export function filterTopLevelExportNodes(nodes: SceneNode[]): SceneNode[] {
  const exportIds = new Set(nodes.map((n) => n.id));
  return nodes.filter((node) => {
    let p: BaseNode | null = node.parent;
    while (p) {
      if ('id' in p && exportIds.has(p.id)) {
        return false;
      }
      p = p.parent;
    }
    return true;
  });
}
