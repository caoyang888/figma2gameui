import { ReportCollector } from '../../pipeline/report';
import { extractConstraintSpec } from '../discovery/constraints';
import { mapAutoLayoutToIr } from '../discovery/layoutMap';
import type { NodeRole } from '../discovery/annotate';
import type { IrColor, IrContainer, IrFrame, IrNode, IrSprite, IrText } from './schema';

function nodeSize(node: SceneNode): { width: number; height: number } {
  if ('width' in node && 'height' in node) {
    return { width: Number(node.width), height: Number(node.height) };
  }
  return { width: 0, height: 0 };
}

function nodePosition(node: SceneNode): { x: number; y: number } {
  if ('x' in node && 'y' in node) {
    return { x: Number(node.x), y: Number(node.y) };
  }
  return { x: 0, y: 0 };
}

function parentSizeForConstraints(
  node: SceneNode,
  parentNode: SceneNode | null,
): { width: number; height: number } {
  if (parentNode) {
    return nodeSize(parentNode);
  }
  const p = (node as unknown as { parent?: BaseNode | null }).parent;
  if (p && 'width' in p && 'height' in p) {
    return { width: Number(p.width), height: Number(p.height) };
  }
  return nodeSize(node);
}

function nodeOpacity(node: SceneNode): number {
  return 'opacity' in node && typeof node.opacity === 'number' ? node.opacity : 1;
}

function solidPaintToColor(paint: Paint): IrColor | undefined {
  if (paint.type !== 'SOLID' || !paint.color) {
    return undefined;
  }
  const { r, g, b } = paint.color;
  const a = 'opacity' in paint && typeof paint.opacity === 'number' ? paint.opacity : 1;
  return { r, g, b, a };
}

function firstSolidFillColor(node: TextNode): IrColor | undefined {
  const fills = node.fills;
  if (!Array.isArray(fills)) {
    return undefined;
  }
  for (const p of fills) {
    if (p.visible === false) {
      continue;
    }
    const c = solidPaintToColor(p);
    if (c) {
      return c;
    }
  }
  return undefined;
}

function firstVisibleSolidStrokeOutline(node: TextNode, report: ReportCollector): IrText['outline'] | undefined {
  const mixed: unknown =
    typeof figma !== 'undefined' && 'mixed' in figma ? (figma as { mixed: unknown }).mixed : Symbol('figma.mixed');
  if (node.strokes === mixed) {
    report.add('info', 'Mixed strokes on TEXT; outline not exported', node.id);
    return undefined;
  }
  if (node.strokeWeight === mixed) {
    report.add('info', 'Mixed strokeWeight on TEXT; outline not exported', node.id);
    return undefined;
  }
  const strokes = node.strokes;
  if (!Array.isArray(strokes) || strokes.length === 0) {
    return undefined;
  }
  const w = Number(node.strokeWeight);
  if (!Number.isFinite(w) || w <= 0) {
    return undefined;
  }
  for (const p of strokes) {
    if (p.visible === false) {
      continue;
    }
    const c = solidPaintToColor(p);
    if (c) {
      return { width: w, color: c };
    }
  }
  return undefined;
}

function mapText(
  node: TextNode,
  report: ReportCollector,
  placement: { x: number; y: number; width: number; height: number },
  parentSize?: { width: number; height: number },
): IrText {
  let fontFamily = 'Inter';
  let fontStyle = 'Regular';
  const mixed: unknown =
    typeof figma !== 'undefined' && 'mixed' in figma ? (figma as { mixed: unknown }).mixed : Symbol('figma.mixed');
  if (node.fontName !== mixed) {
    const fontName = node.fontName as FontName;
    fontFamily = fontName.family;
    fontStyle = fontName.style;
  } else {
    report.add('error', 'Mixed fontName on TEXT node; using Inter Regular', node.id);
  }
  let fontSize = 12;
  if (node.fontSize !== mixed) {
    fontSize = Number(node.fontSize);
  } else {
    report.add('info', 'Mixed fontSize on TEXT node; using 12', node.id);
  }
  const color = firstSolidFillColor(node);
  const outline = firstVisibleSolidStrokeOutline(node, report);
  const spec = parentSize ? extractConstraintSpec(node, parentSize, placement) : undefined;
  const base: IrText = {
    kind: 'text',
    id: node.id,
    name: node.name,
    placement,
    opacity: nodeOpacity(node),
    visible: true,
    extensions: spec ? { constraints: spec } : {},
    characters: node.characters,
    fontFamily,
    fontStyle,
    fontSize,
    color,
  };
  if (outline) {
    base.outline = outline;
  }
  return base;
}

/** Stable asset reference matching the raster filename convention. */
export function exportAssetRefForNodeId(nodeId: string): string {
  return `export-${nodeId.replace(/:/g, '-')}.png`;
}

function mapImagePlaceholder(node: SceneNode): IrSprite {
  const { width, height } = nodeSize(node);
  const placement = { x: 0, y: 0, width, height };
  return {
    kind: 'sprite',
    id: `${node.id}:export`,
    name: `${node.name}__export`,
    placement,
    opacity: 1,
    visible: true,
    // Synthetic export placeholder should not inherit constraints from source node.
    // Widget should be created on the structural IR node (container/text), not this raster child.
    extensions: {},
    assetRef: exportAssetRefForNodeId(node.id),
  };
}

/** Compute text placement relative to the export root via absoluteBoundingBox. */
function textPlacementRelativeToExportRoot(
  exportRoot: SceneNode,
  textNode: SceneNode,
): { x: number; y: number; width: number; height: number } {
  const rootBox = exportRoot.absoluteBoundingBox;
  const textBox = textNode.absoluteBoundingBox;
  if (rootBox && textBox) {
    return {
      x: textBox.x - rootBox.x,
      y: textBox.y - rootBox.y,
      width: textBox.width,
      height: textBox.height,
    };
  }
  const { width, height } = nodeSize(textNode);
  const { x, y } = nodePosition(textNode);
  return { x, y, width, height };
}

function tryAttachLayout(node: SceneNode, container: IrContainer, report: ReportCollector): void {
  if ('layoutMode' in node) {
    const layout = mapAutoLayoutToIr(node as SceneNode & ChildrenMixin & AutoLayoutMixin, report);
    if (layout) {
      container.layout = layout;
    }
  }
}

/**
 * Compute child placement relative to parent using absoluteBoundingBox.
 * Falls back to nodePosition/nodeSize when absoluteBoundingBox is unavailable.
 */
function placementRelativeToParent(
  parent: SceneNode | FrameNode,
  child: SceneNode,
): { x: number; y: number; width: number; height: number } {
  const parentBox = (parent as unknown as { absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null }).absoluteBoundingBox;
  const childBox = child.absoluteBoundingBox;
  if (parentBox && childBox) {
    return {
      x: childBox.x - parentBox.x,
      y: childBox.y - parentBox.y,
      width: childBox.width,
      height: childBox.height,
    };
  }
  return { ...nodePosition(child), ...nodeSize(child) };
}


// ---------------------------------------------------------------------------
// Annotation-driven IR building (inside an export root's subtree)
// ---------------------------------------------------------------------------

/**
 * Recursively build the IR subtree for one export root, consuming the annotation map.
 *
 * - role=pruned       → skip entirely
 * - role=label        → collected separately and attached to export root container
 * - role=childExport  → rasterize=true: mapImagePlaceholder; rasterize=false: container-only
 * - role=passthrough  → container that preserves hierarchy
 * - role=exportRoot   → when it's the root of this call it's the export root;
 *                       when encountered as a nested child, treated like childExport
 */
function buildContainerFromAnnotation(
  node: SceneNode,
  parentNode: SceneNode | null,
  roles: ReadonlyMap<string, NodeRole>,
  report: ReportCollector,
  forceOrigin: boolean,
  exportRoot: SceneNode,
  labelTexts: { node: TextNode; placement: { x: number; y: number; width: number; height: number } }[],
): IrContainer {
  const renderPlacement = forceOrigin
    ? { x: 0, y: 0, ...nodeSize(node) }
    : parentNode
      ? placementRelativeToParent(parentNode, node)
      : { ...nodePosition(node), ...nodeSize(node) };
  const constraintPlacement = parentNode
    ? placementRelativeToParent(parentNode, node)
    : { ...nodePosition(node), ...nodeSize(node) };

  const base: IrContainer = {
    kind: 'container',
    id: node.id,
    name: node.name,
    placement: renderPlacement,
    opacity: nodeOpacity(node),
    visible: true,
    extensions: {},
    children: [],
  };
  const parentSize = parentSizeForConstraints(node, parentNode);
  const spec = extractConstraintSpec(node, parentSize, constraintPlacement);
  if (spec) {
    base.extensions = { ...base.extensions, constraints: spec };
  }

  const nodeRole = roles.get(node.id);
  if (
    nodeRole &&
    (nodeRole.role === 'exportRoot' || nodeRole.role === 'childExport') &&
    nodeRole.rasterize
  ) {
    base.children.push(mapImagePlaceholder(node));
  }

  if ('children' in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      const childRole = roles.get(child.id);
      if (!childRole || childRole.role === 'pruned') continue;

      if (childRole.role === 'label') {
        labelTexts.push({
          node: child as TextNode,
          placement: textPlacementRelativeToExportRoot(exportRoot, child),
        });
        continue;
      }

      if (childRole.role === 'childExport' || childRole.role === 'exportRoot') {
        if (childRole.rasterize) {
          const childPlacement = placementRelativeToParent(node, child);
          base.children.push({
            ...mapImagePlaceholder(child),
            placement: childPlacement,
          });
        } else {
          base.children.push(
            buildContainerFromAnnotation(
              child,
              node,
              roles,
              report,
              false,
              exportRoot,
              labelTexts,
            ),
          );
        }
        continue;
      }

      if (childRole.role === 'passthrough') {
        base.children.push(
          buildContainerFromAnnotation(
            child,
            node,
            roles,
            report,
            false,
            exportRoot,
            labelTexts,
          ),
        );
        continue;
      }
    }
  }

  tryAttachLayout(node, base, report);
  return base;
}

/**
 * Build IR for one export root using annotation roles.
 * Label nodes are collected and placed as direct children of the root container
 * with coordinates relative to the export root.
 */
function buildExportSubtreeIr(
  exportRoot: SceneNode,
  roles: ReadonlyMap<string, NodeRole>,
  report: ReportCollector,
): IrNode[] {
  if (exportRoot.type === 'TEXT') {
    return [mapImagePlaceholder(exportRoot)];
  }

  const labelTexts: { node: TextNode; placement: { x: number; y: number; width: number; height: number } }[] = [];
  const container = buildContainerFromAnnotation(
    exportRoot, null, roles, report, true, exportRoot, labelTexts,
  );

  for (const { node, placement } of labelTexts) {
    container.children.push(
      mapText(node, report, placement, { width: container.placement.width, height: container.placement.height }),
    );
  }

  return [container];
}

// ---------------------------------------------------------------------------
// Frame-level IR building: walks the frame tree using roles
// ---------------------------------------------------------------------------

/**
 * Build the IR tree for children of a frame or passthrough container.
 * Preserves passthrough hierarchy instead of flattening export roots.
 * All positions computed via absoluteBoundingBox differences for consistency.
 */
function buildFrameLevelChildren(
  parent: SceneNode | FrameNode,
  roles: ReadonlyMap<string, NodeRole>,
  report: ReportCollector,
): IrNode[] {
  const result: IrNode[] = [];
  if (!('children' in parent)) return result;

  for (const child of parent.children) {
    const role = roles.get(child.id);
    if (!role || role.role === 'pruned') continue;

    if (role.role === 'exportRoot') {
      const placement = placementRelativeToParent(parent, child);
      const subtree = buildExportSubtreeIr(child, roles, report);
      const rootNode = subtree[0];
      if (rootNode) {
        result.push({ ...rootNode, placement: { ...rootNode.placement, x: placement.x, y: placement.y } });
      }
      continue;
    }

    if (role.role === 'passthrough') {
      const placement = placementRelativeToParent(parent, child);
      const parentSize = nodeSize(parent as SceneNode);
      const spec = extractConstraintSpec(child, parentSize, placement);
      const container: IrContainer = {
        kind: 'container',
        id: child.id,
        name: child.name,
        placement,
        opacity: nodeOpacity(child),
        visible: true,
        extensions: spec ? { constraints: spec } : {},
        children: buildFrameLevelChildren(child, roles, report),
      };
      tryAttachLayout(child, container, report);
      result.push(container);
      continue;
    }
  }
  return result;
}

export function buildFrameIr(
  frame: FrameNode,
  roles: ReadonlyMap<string, NodeRole>,
  report: ReportCollector,
): IrFrame {
  const frameRole = roles.get(frame.id);
  if (frameRole?.role === 'exportRoot') {
    const subtree = buildExportSubtreeIr(frame as unknown as SceneNode, roles, report);
    const rootNode = subtree[0];
    const children = rootNode
      ? [{ ...rootNode, placement: { ...rootNode.placement, x: 0, y: 0 } }]
      : [];
    return {
      id: frame.id,
      name: frame.name,
      width: Number(frame.width),
      height: Number(frame.height),
      children,
      assets: [],
    };
  }

  const children = buildFrameLevelChildren(frame, roles, report);
  return {
    id: frame.id,
    name: frame.name,
    width: Number(frame.width),
    height: Number(frame.height),
    children,
    assets: [],
  };
}
