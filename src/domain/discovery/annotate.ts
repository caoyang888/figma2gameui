export type NodeRole =
  | { role: 'exportRoot'; rasterize: boolean }
  | { role: 'childExport'; rasterize: boolean }
  | { role: 'label'; rasterize: false }
  | { role: 'passthrough' }
  | { role: 'pruned' };

function hasExportSettings(node: SceneNode): boolean {
  return 'exportSettings' in node && Array.isArray(node.exportSettings) && node.exportSettings.length > 0;
}

function hasChildren(node: SceneNode): node is SceneNode & ChildrenMixin {
  return 'children' in node && Array.isArray(node.children);
}

/**
 * Whether this exported non-TEXT node should get its own PNG raster.
 * - If every visible direct child has Export → false (children cover the slice).
 * - If a direct child has no Export but its subtree contains deeper exports → false:
 *   rasterizing the parent would {@link collectNodesToHideForExport} hide those childExports → empty/transparent PNG.
 * - If a direct child has no Export and no export anywhere below → true (parent must carry non-exported art).
 */
function shouldRasterizeExportContainer(
  node: SceneNode,
  subtreeHasExportByNodeId: ReadonlyMap<string, boolean>,
): boolean {
  if (node.type === 'TEXT') {
    return true;
  }
  if (!hasChildren(node) || node.children.length === 0) {
    return true;
  }
  for (const child of node.children) {
    if (child.visible === false) {
      continue;
    }
    if (!hasExportSettings(child)) {
      if (subtreeHasExportByNodeId.get(child.id) === true) {
        continue;
      }
      return true;
    }
  }
  return false;
}

/**
 * Pass 1 (bottom-up): for every node, does any visible descendant carry export settings?
 * This drives the passthrough vs pruned decision for non-export containers.
 */
function buildSubtreeHasExportMap(root: SceneNode): Map<string, boolean> {
  const map = new Map<string, boolean>();

  function walk(node: SceneNode): boolean {
    if (node.visible === false) {
      map.set(node.id, false);
      return false;
    }
    if (hasExportSettings(node)) {
      map.set(node.id, true);
      if (hasChildren(node)) {
        for (const child of node.children) walk(child);
      }
      return true;
    }
    let any = false;
    if (hasChildren(node)) {
      for (const child of node.children) {
        if (walk(child)) any = true;
      }
    }
    map.set(node.id, any);
    return any;
  }

  walk(root);
  return map;
}

/**
 * Pass 2 (top-down): assign a role to every visible node in the subtree.
 *
 * Rules (per the confirmed spec):
 *  1. Non-TEXT with export + no exported ancestor -> exportRoot (top-level, rasterize)
 *  2. Non-TEXT with export + has exported ancestor -> childExport (nested sprite, rasterize, hidden from parent PNG)
 *  3. TEXT with export + has exported ancestor -> label (no rasterize, hidden from parent PNG)
 *  4. TEXT with export + no exported ancestor -> exportRoot (rasterize as image)
 *  5. No export + subtree has export descendants -> passthrough (keep as container)
 *  6. No export + subtree has no export descendants -> pruned
 */
function assignRoles(
  node: SceneNode,
  ancestorExported: boolean,
  subtreeMap: Map<string, boolean>,
  roles: Map<string, NodeRole>,
): void {
  if (node.visible === false) {
    roles.set(node.id, { role: 'pruned' });
    return;
  }

  const nodeHasExport = hasExportSettings(node);
  const isText = node.type === 'TEXT';

  if (nodeHasExport) {
    const rasterize = shouldRasterizeExportContainer(node, subtreeMap);
    if (isText) {
      if (ancestorExported) {
        roles.set(node.id, { role: 'label', rasterize: false });
      } else {
        roles.set(node.id, { role: 'exportRoot', rasterize: true });
      }
    } else {
      if (ancestorExported) {
        roles.set(node.id, { role: 'childExport', rasterize });
      } else {
        roles.set(node.id, { role: 'exportRoot', rasterize });
      }
    }
  } else {
    const subtreeHasExport = subtreeMap.get(node.id) ?? false;
    if (subtreeHasExport) {
      roles.set(node.id, { role: 'passthrough' });
    } else {
      roles.set(node.id, { role: 'pruned' });
    }
  }

  if (hasChildren(node)) {
    const nextAncestorExported = ancestorExported || nodeHasExport;
    for (const child of node.children) {
      assignRoles(child, nextAncestorExported, subtreeMap, roles);
    }
  }
}

/**
 * Annotate every node in the frame's subtree with its export role.
 * Pure function: does not mutate any Figma nodes.
 */
export function annotateExportTree(frame: FrameNode): Map<string, NodeRole> {
  const subtreeMap = buildSubtreeHasExportMap(frame as unknown as SceneNode);
  const roles = new Map<string, NodeRole>();

  // 从勾选 Frame 根开始递归：支持把导出设置加在 Frame 自身（与 discoverExportNodesInFrame 一致）。
  assignRoles(frame as unknown as SceneNode, false, subtreeMap, roles);

  return roles;
}

/**
 * From an annotation map, collect SceneNode references for nodes that should be
 * hidden before a specific export root's PNG export (labels + child exports).
 */
export function collectNodesToHideForExport(
  exportRoot: SceneNode,
  roles: ReadonlyMap<string, NodeRole>,
): SceneNode[] {
  const result: SceneNode[] = [];

  function walk(node: SceneNode): void {
    if (node === exportRoot) {
      if (hasChildren(node)) {
        for (const child of node.children) walkDescendants(child);
      }
      return;
    }
  }

  function walkDescendants(node: SceneNode): void {
    const role = roles.get(node.id);
    if (!role) return;
    if (role.role === 'label' || role.role === 'childExport') {
      result.push(node);
      return;
    }
    if (hasChildren(node)) {
      for (const child of node.children) walkDescendants(child);
    }
  }

  walk(exportRoot);
  return result;
}

/**
 * Get all nodes that should be individually rasterized within a frame's annotation.
 * Returns them grouped: exportRoots first (top-level), then childExports are reachable
 * via the tree but each gets its own PNG too.
 */
export function collectRasterNodes(
  frame: FrameNode,
  roles: ReadonlyMap<string, NodeRole>,
): SceneNode[] {
  const result: SceneNode[] = [];

  function walk(node: SceneNode): void {
    const role = roles.get(node.id);
    if (!role) return;
    if (role.role === 'exportRoot' || role.role === 'childExport') {
      if ('rasterize' in role && role.rasterize) {
        result.push(node);
      }
    }
    if (hasChildren(node)) {
      for (const child of node.children) walk(child);
    }
  }

  walk(frame as unknown as SceneNode);
  return result;
}

