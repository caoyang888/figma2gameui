import type { IR, IrNode } from '../domain/ir/schema';

function walkIrNodes(nodes: readonly IrNode[], visit: (n: IrNode) => void): void {
  for (const n of nodes) {
    visit(n);
    if ('children' in n && n.children.length > 0) {
      walkIrNodes(n.children, visit);
    }
  }
}

/** 移除 Figma Constraints 相关 IR，各引擎将退回纯 placement 布局。 */
export function stripConstraintsFromIr(ir: IR): void {
  for (const frame of ir.frames) {
    walkIrNodes(frame.children, (node) => {
      delete node.fitQuality;
      delete node.reasonCode;
      delete node.errorMetrics;
      const ext = node.extensions;
      if (!ext || typeof ext !== 'object') {
        node.extensions = {};
        return;
      }
      const next = { ...(ext as Record<string, unknown>) };
      delete next.constraints;
      delete next.widget;
      delete next.constraintsDebug;
      node.extensions = next;
    });
  }
}

/** 移除 Figma Auto Layout 映射的 `layout` 字段。 */
export function stripFigmaAutoLayoutFromIr(ir: IR): void {
  for (const frame of ir.frames) {
    walkIrNodes(frame.children, (node) => {
      delete node.layout;
    });
  }
}
