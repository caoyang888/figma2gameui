import { ReportCollector } from '../../pipeline/report';
import type { IrLayoutFlex } from '../ir/schema';

function unsupported(report: ReportCollector, detail: string, nodeId: string): void {
  report.add('error', `Unsupported Auto Layout property ignored: ${detail}`, nodeId);
}

function scanAutoLayoutChildren(node: SceneNode & ChildrenMixin & AutoLayoutMixin, report: ReportCollector): void {
  for (const child of node.children) {
    if (child.visible === false) {
      continue;
    }
    if ('layoutGrow' in child && child.layoutGrow !== 0) {
      unsupported(report, `child layoutGrow=${child.layoutGrow} (node ${child.id})`, node.id);
    }
    if ('layoutAlign' in child && child.layoutAlign !== 'INHERIT' && child.layoutAlign !== 'MIN') {
      unsupported(report, `child layoutAlign=${child.layoutAlign} (node ${child.id})`, node.id);
    }
    if ('layoutPositioning' in child && child.layoutPositioning !== 'AUTO') {
      unsupported(report, `child layoutPositioning=${child.layoutPositioning} (node ${child.id})`, node.id);
    }
  }
}

/**
 * Maps Figma Auto Layout on a container to a minimal flex IR subset.
 * Returns `undefined` when `layoutMode === 'NONE'` or when layout is GRID (unsupported).
 */
export function mapAutoLayoutToIr(
  node: SceneNode & ChildrenMixin & AutoLayoutMixin,
  report: ReportCollector,
): IrLayoutFlex | undefined {
  if (node.layoutMode === 'NONE') {
    return undefined;
  }
  if (node.layoutMode === 'GRID') {
    unsupported(report, 'layoutMode=GRID', node.id);
    return undefined;
  }

  if (node.primaryAxisAlignItems !== 'MIN') {
    unsupported(report, `primaryAxisAlignItems=${node.primaryAxisAlignItems}`, node.id);
  }
  if (node.counterAxisAlignItems !== 'MIN') {
    unsupported(report, `counterAxisAlignItems=${node.counterAxisAlignItems}`, node.id);
  }
  if (node.primaryAxisSizingMode !== 'FIXED') {
    unsupported(report, `primaryAxisSizingMode=${node.primaryAxisSizingMode}`, node.id);
  }
  if (node.counterAxisSizingMode !== 'FIXED') {
    unsupported(report, `counterAxisSizingMode=${node.counterAxisSizingMode}`, node.id);
  }
  if (node.layoutWrap !== 'NO_WRAP') {
    unsupported(report, `layoutWrap=${node.layoutWrap}`, node.id);
  }
  if (node.strokesIncludedInLayout) {
    unsupported(report, 'strokesIncludedInLayout=true', node.id);
  }
  if (node.counterAxisAlignContent !== 'AUTO') {
    unsupported(report, `counterAxisAlignContent=${node.counterAxisAlignContent}`, node.id);
  }
  if (node.itemReverseZIndex) {
    unsupported(report, 'itemReverseZIndex=true', node.id);
  }
  const cxs = node.counterAxisSpacing;
  if (cxs !== null && cxs !== 0) {
    unsupported(report, `counterAxisSpacing=${cxs}`, node.id);
  }

  if ('layoutSizingHorizontal' in node && node.layoutSizingHorizontal !== 'FIXED') {
    unsupported(report, `layoutSizingHorizontal=${node.layoutSizingHorizontal}`, node.id);
  }
  if ('layoutSizingVertical' in node && node.layoutSizingVertical !== 'FIXED') {
    unsupported(report, `layoutSizingVertical=${node.layoutSizingVertical}`, node.id);
  }

  scanAutoLayoutChildren(node, report);

  const direction = node.layoutMode === 'HORIZONTAL' ? 'row' : 'column';
  return {
    type: 'flex',
    direction,
    gap: node.itemSpacing,
    padding: {
      left: node.paddingLeft,
      right: node.paddingRight,
      top: node.paddingTop,
      bottom: node.paddingBottom,
    },
  };
}
