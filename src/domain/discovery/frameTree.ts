/// <reference types="@figma/plugin-typings" />
import type { FrameTreeNodeWire } from '../../types/frameTree';

/**
 * 相对 PAGE 的深度：仅包含 PAGE 的直接子节点（画布左侧「图层」根这一层），不再向下序列化。
 */
const MAX_DEPTH_FROM_PAGE = 1;

function serializeSceneSubtree(node: BaseNode, depthFromPage: number): FrameTreeNodeWire | null {
  if (node.type === 'PAGE') {
    const ch = 'children' in node ? [...node.children] : [];
    const children = ch
      .map((c) => serializeSceneSubtree(c, 1))
      .filter((x): x is FrameTreeNodeWire => Boolean(x));
    return {
      id: node.id,
      name: node.name,
      type: 'PAGE',
      isExportFrame: false,
      children,
    };
  }

  const allowChildSerialization = depthFromPage < MAX_DEPTH_FROM_PAGE;

  let children: FrameTreeNodeWire[] = [];
  if (allowChildSerialization && 'children' in node && node.children && node.children.length > 0) {
    children = [...node.children]
      .map((c) => serializeSceneSubtree(c, depthFromPage + 1))
      .filter((x): x is FrameTreeNodeWire => Boolean(x));
  }

  if (node.type === 'FRAME') {
    return {
      id: node.id,
      name: node.name,
      type: 'FRAME',
      isExportFrame: true,
      children,
    };
  }

  if (!('children' in node) || !node.children || node.children.length === 0) {
    return null;
  }
  if (children.length === 0) {
    return null;
  }
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    isExportFrame: false,
    children,
  };
}

export function buildFrameTreeRoots(): FrameTreeNodeWire[] {
  const roots: FrameTreeNodeWire[] = [];
  for (const page of figma.root.children) {
    if (page.type !== 'PAGE') {
      continue;
    }
    const sub = serializeSceneSubtree(page);
    if (sub) {
      roots.push(sub);
    }
  }
  return roots;
}
