/** Bounded validation for untrusted candidate plans from an AI or JSON editor. */
export const MAX_NODES = 400;
export const MAX_ISSUES = 100;
export const MAX_CANVAS = 16384;
export const MAX_DEPTH = 64;

const KINDS = ['container', 'sprite', 'label', 'button', 'layout'] as const;
const PARENTS = new Set<NodeKind>(['container', 'layout', 'button']);
const DIRECTIONS = ['horizontal', 'vertical', 'row', 'column'] as const;
const ALIGNMENTS = ['start', 'center', 'end', 'stretch', 'left', 'right', 'top', 'bottom',
  'top-left', 'top-center', 'top-right', 'center-left', 'center-right',
  'bottom-left', 'bottom-center', 'bottom-right'] as const;
const SEVERITIES = ['info', 'warning', 'error'] as const;
const NODE_REQUIRED = ['id', 'parentId', 'kind', 'name', 'x', 'y', 'width', 'height'] as const;
const NODE_OPTIONAL = ['assetId', 'text', 'fontAssetId', 'align', 'direction', 'gap'] as const;
const ID = /^[A-Za-z0-9_-][A-Za-z0-9_.:-]{0,63}(?![\s\S])/;
// Unicode whitespace under Python str.strip, including four nonprinting C0 separators but not BOM.
const PY_WHITESPACE_EDGES = /^[\p{White_Space}\u001c-\u001f]+|[\p{White_Space}\u001c-\u001f]+$/gu;
const DISALLOWED_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\uD800-\uDFFF]/u;

export type NodeKind = typeof KINDS[number];
export type Alignment = typeof ALIGNMENTS[number];
export type Direction = 'horizontal' | 'vertical';
export type IssueSeverity = typeof SEVERITIES[number];
export interface PlanNode {
  id: string;
  parentId: string | null;
  kind: NodeKind;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  assetId?: string;
  text?: string;
  fontAssetId?: string;
  align?: Alignment;
  direction?: Direction;
  gap?: number;
}
export interface PlanIssue {
  message: string;
  resolution?: string;
  severity?: IssueSeverity;
}
export interface Plan {
  width: number;
  height: number;
  nodes: PlanNode[];
  issues: PlanIssue[];
}

export class PlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanValidationError';
  }
}

export const PLAN_INSTRUCTIONS = `仅返回一个 JSON 对象，不要 Markdown、代码或外链。
顶层只包含 width、height、nodes、issues。画布宽高为 1–16384。nodes 最多 400 个，
每个节点有 id、parentId、kind、name、x、y、width、height。坐标是整个画布左上角起算的
绝对坐标，不是父节点坐标。矩形必须完整落在画布且宽高大于 0。id 为 1–64 位 ASCII
字母、数字、下划线或连字符开头，后续也可用点和冒号；id 唯一。恰好一个 container
根节点（parentId 为 null），其他节点均填已定义的父节点 id，不得有环。
kind 只用 container、layout、button、sprite、label。只有前 3 种可以作为父节点。
sprite 必填 assetId，button 可填 assetId，label 必填 text（可用空串表示动态文本）且可选
fontAssetId；仅可引用提供的资产 ID。缺失素材时用 container 占位，在 issues 写清楚缺了什么，
不要发明 ID 或用空 sprite。layout 必填 direction（horizontal 或 vertical），gap 可选且非负。
可选 align: start、center、end、stretch、left、right、top、bottom，或 top-left、
top-center、top-right、center-left、center-right、bottom-left、bottom-center、bottom-right。
issues 最多 100 项：每项含 message，可选 resolution（文本）和 severity（info、warning、error）。
不存在的可选字段直接省略，不要用 null。所有文本为纯文本。`;

function fail(where: string, what: string): never {
  throw new PlanValidationError(`${where}：${what}`);
}

function object(value: unknown, required: readonly string[], optional: readonly string[], where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
      || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    return fail(where, '应为 JSON 对象');
  }
  const o = value as Record<string, unknown>;
  const missing = required.filter(k => !Object.hasOwn(o, k));
  if (missing.length) fail(where, '缺少必填字段：' + missing.sort().join('、'));
  if (Object.keys(o).some(k => !required.includes(k) && !optional.includes(k))) fail(where, '含不支持的字段');
  return o;
}

function strip(value: string): string { return value.replace(PY_WHITESPACE_EDGES, ''); }
function tooLong(value: string, max: number): boolean {
  let count = 0;
  for (const ch of value) {
    if (++count > max) return true;
  }
  return false;
}
function string(value: unknown, where: string, max: number, blank = false): string {
  if (typeof value !== 'string' || tooLong(value, max) || (!blank && !strip(value))) {
    return fail(where, `应为${blank ? '可为空的' : '非空'}文本，最多 ${max} 字符`);
  }
  if (DISALLOWED_TEXT.test(value)) fail(where, '含不支持的控制字符');
  return value;
}
function number(value: unknown, lower: number, upper: number, where: string, positive = false): number {
  if (typeof value !== 'number' || value < lower || value > upper || !Number.isFinite(value) || (positive && value <= 0)) {
    return fail(where, `应为${positive ? '大于 0 且' : '不小于 ' + lower + ' 且'}不大于 ${upper} 的有限数字`);
  }
  return value;
}
function id(value: unknown, where: string): string {
  if (typeof value !== 'string' || !ID.test(value)) return fail(where, '应为安全的节点 ID（1–64 位字母、数字、下划线等）');
  return value;
}
function asset(value: unknown, asset_ids: ReadonlySet<string>, where: string): string {
  if (typeof value !== 'string' || !value || tooLong(value, 160) || !asset_ids.has(value)) {
    return fail(where, '必须引用已提供的资产；没有素材时请使用容器占位并记录问题');
  }
  return value;
}
function choice<T extends string>(value: unknown, allowed: readonly T[], where: string, detail: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) return fail(where, detail);
  return value as T;
}

/** Return a canonical fresh copy while retaining the input order of nodes and issues. */
export function validate_plan(value: unknown, asset_ids: ReadonlySet<string>): Plan {
  const raw = object(value, ['width', 'height', 'nodes', 'issues'], [], '方案');
  const width = number(raw.width, 1, MAX_CANVAS, '画布宽度');
  const height = number(raw.height, 1, MAX_CANVAS, '画布高度');
  const raw_nodes = raw.nodes;
  if (!Array.isArray(raw_nodes) || raw_nodes.length < 1 || raw_nodes.length > MAX_NODES) {
    return fail('节点列表', `应包含 1–${MAX_NODES} 个节点`);
  }
  const nodes: PlanNode[] = [], by_id = new Map<string, PlanNode>(), labels = new Map<string, string>(), roots: string[] = [];
  for (const [i, value] of raw_nodes.entries()) {
    const where = `节点 ${i + 1}`;
    const n = object(value, NODE_REQUIRED, NODE_OPTIONAL, where);
    const ident = id(n.id, where + ' ID');
    if (by_id.has(ident)) fail(where, '节点 ID 重复');
    const kind = choice(n.kind, KINDS, where, '未知节点类型');
    const parent = n.parentId === null ? null : id(n.parentId, where + ' 父节点 ID');
    if (parent === null) {
      roots.push(ident);
      if (kind !== 'container') fail(where, '根节点必须是容器');
    }
    const name = strip(string(n.name, where + ' 名称', 100));
    const x = number(n.x, 0, width, where + ' X');
    const y = number(n.y, 0, height, where + ' Y');
    const w = number(n.width, 0, width, where + ' 宽度', true);
    const h = number(n.height, 0, height, where + ' 高度', true);
    if (x + w > width + 1e-9 || y + h > height + 1e-9) fail(where, '矩形超出画布');
    const canon: PlanNode = { id: ident, parentId: parent, kind, name, x, y, width: w, height: h };
    if (kind === 'sprite' && !Object.hasOwn(n, 'assetId')) fail(where, 'Sprite 缺少资产；没有素材时请使用容器占位并记录问题');
    if (Object.hasOwn(n, 'assetId')) {
      if (kind !== 'sprite' && kind !== 'button') fail(where, '仅 Sprite 或按钮可引用图片资产');
      canon.assetId = asset(n.assetId, asset_ids, where + ' 图片');
    }
    if (kind === 'label') {
      if (!Object.hasOwn(n, 'text')) fail(where, 'Label 必须提供 text 字段（动态文本可留空）');
      canon.text = string(n.text, where + ' 文本', 4000, true);
      if (Object.hasOwn(n, 'fontAssetId')) canon.fontAssetId = asset(n.fontAssetId, asset_ids, where + ' 字体');
    } else if (Object.hasOwn(n, 'text') || Object.hasOwn(n, 'fontAssetId')) fail(where, '仅 Label 可提供文本和字体');
    if (Object.hasOwn(n, 'align')) canon.align = choice(n.align, ALIGNMENTS, where + ' 对齐', '不支持的对齐方式');
    if (kind === 'layout') {
      const d = choice(n.direction, DIRECTIONS, where + ' 排列', '应为 horizontal 或 vertical');
      canon.direction = d === 'row' ? 'horizontal' : d === 'column' ? 'vertical' : d;
      if (Object.hasOwn(n, 'gap')) canon.gap = number(n.gap, 0, MAX_CANVAS, where + ' 间距');
    } else if (Object.hasOwn(n, 'direction') || Object.hasOwn(n, 'gap')) fail(where, '仅布局节点可以设置排列方向和间距');
    nodes.push(canon); by_id.set(ident, canon); labels.set(ident, where);
  }
  if (roots.length !== 1) fail('节点树', '必须恰好有一个根容器');
  const root = roots[0]!;
  for (const n of nodes) {
    if (n.parentId === null) continue;
    const parent = by_id.get(n.parentId);
    const where = labels.get(n.id)!;
    if (!parent) fail(where, '父节点不存在');
    if (!PARENTS.has(parent.kind)) fail(where, '父节点应为容器、布局或按钮');
  }
  const depths = new Map<string, number>([[root, 0]]);
  for (const n of nodes) {
    const trail: string[] = [], visiting = new Set<string>();
    let current = n.id;
    while (!depths.has(current)) {
      if (visiting.has(current)) fail(labels.get(n.id)!, '节点树含循环，无法连接到根容器');
      trail.push(current); visiting.add(current);
      current = by_id.get(current)!.parentId!;
    }
    let depth = depths.get(current)!;
    for (const node_id of trail.reverse()) {
      if (++depth > MAX_DEPTH) fail(labels.get(node_id)!, `层级深度不可超过 ${MAX_DEPTH}`);
      depths.set(node_id, depth);
    }
  }
  const raw_issues = raw.issues;
  if (!Array.isArray(raw_issues) || raw_issues.length > MAX_ISSUES) return fail('问题列表', `应为最多 ${MAX_ISSUES} 项的数组`);
  const issues: PlanIssue[] = [];
  for (const [i, value] of raw_issues.entries()) {
    const where = `问题 ${i + 1}`;
    const item = object(value, ['message'], ['resolution', 'severity'], where);
    const canon: PlanIssue = { message: string(item.message, where, 600) };
    if (Object.hasOwn(item, 'resolution')) canon.resolution = string(item.resolution, where + ' 处理说明', 600);
    if (Object.hasOwn(item, 'severity')) canon.severity = choice(item.severity, SEVERITIES, where, '不支持的问题等级');
    issues.push(canon);
  }
  return { width, height, nodes, issues };
}
