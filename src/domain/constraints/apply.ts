/**
 * 路线 A（权威）：在完整 IR 上为含 `extensions.constraints` 的节点写入 `widget` 与 fit 元数据。
 * Widget 数值来自提取阶段的 `widgetNumbers`（设计父尺寸快照）+ `toWidgetConfig` 的轴开关映射；
 * 不使用 `solveRect` 驱动写入。见 `docs/superpowers/specs/2026-04-16-figma-constraints-widget-mapping-design.md`。
 */
import type { ReportCollector } from '../../pipeline/report';
import { analyzeCocos3Fit } from './capability';
import type { ConstraintSpec } from './model';
import type { IR, IrNode } from '../ir/schema';
import { toWidgetConfig } from '../emitters/cocos3/widgetAdapter';

function asConstraintSpec(value: unknown): ConstraintSpec | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Partial<ConstraintSpec>;
  if (!v.base || !v.horizontal || !v.vertical) return undefined;
  return v as ConstraintSpec;
}

function walk(nodes: IrNode[], visit: (n: IrNode) => void): void {
  for (const n of nodes) {
    visit(n);
    if ('children' in n && Array.isArray(n.children)) {
      walk(n.children, visit);
    }
  }
}

export function applyConstraintFitMetadata(ir: IR, report: ReportCollector): void {
  for (const frame of ir.frames) {
    walk(frame.children, (node) => {
      const ext = (node.extensions ?? {}) as Record<string, unknown>;
      const spec = asConstraintSpec(node.extensions?.constraints);
      if (!spec) {
        node.extensions = {
          ...ext,
          constraintsDebug: {
            sourceNodeId: node.id,
            sourceNodeName: node.name,
            constraintsAttachedAtThisNode: false,
            skippedByAncestorConstraints: false,
            hasConstraintSpec: false,
          },
        };
        return;
      }

      const fit = analyzeCocos3Fit(spec);
      node.fitQuality = fit.quality;
      node.reasonCode = fit.reasonCode;

      if (fit.quality !== 'unsupported') {
        const cfg = toWidgetConfig(spec, fit);
        node.extensions = {
          ...ext,
          widget: cfg,
          constraintsDebug: {
            sourceNodeId: node.id,
            sourceNodeName: node.name,
            constraintsAttachedAtThisNode: true,
            skippedByAncestorConstraints: false,
            hasConstraintSpec: true,
          },
        };
      } else {
        node.extensions = {
          ...ext,
          constraintsDebug: {
            sourceNodeId: node.id,
            sourceNodeName: node.name,
            constraintsAttachedAtThisNode: true,
            skippedByAncestorConstraints: false,
            hasConstraintSpec: true,
          },
        };
      }

      if (fit.quality === 'unsupported') {
        report.add('error', `Constraints 不可映射: ${fit.reasonCode}`, node.id);
      } else if (fit.quality === 'approx') {
        report.add('warning', `Constraints 近似映射: ${fit.reasonCode}`, node.id);
      }
    });
  }
}
