/** Filters the current selection down to Frame nodes, preserving input order. */
export function filterFramesFromSelection(nodes: readonly BaseNode[]): FrameNode[] {
  const frames: FrameNode[] = [];
  for (const node of nodes) {
    if (node.type === 'FRAME') {
      frames.push(node);
    }
  }
  return frames;
}

export type FrameResolveResult = {
  frames: FrameNode[];
  /** 去重后、按输入顺序保留的 id 列表 */
  requestedIds: string[];
  /** `getNodeById` 为 null（已删除或无效 id） */
  missingIds: string[];
  /** 节点存在但不是 FRAME */
  wrongTypeIds: { id: string; type: string }[];
};

/**
 * Resolves persisted frame ids to live `FrameNode`s (skips missing or wrong types).
 * Order follows `ids` with de-duplication.
 */
export function resolveFramesByIdsDetailed(ids: readonly string[]): FrameResolveResult {
  const frames: FrameNode[] = [];
  const requestedIds: string[] = [];
  const missingIds: string[] = [];
  const wrongTypeIds: { id: string; type: string }[] = [];
  const seen = new Set<string>();

  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    requestedIds.push(id);
    const n = figma.getNodeById(id);
    if (!n) {
      missingIds.push(id);
      continue;
    }
    if (n.type === 'FRAME') {
      frames.push(n);
      continue;
    }
    wrongTypeIds.push({ id, type: n.type });
  }

  return { frames, requestedIds, missingIds, wrongTypeIds };
}

export function resolveFramesByIds(ids: readonly string[]): FrameNode[] {
  return resolveFramesByIdsDetailed(ids).frames;
}

/** 主线程校验 / 导出：无可用 Frame 时的可读错误（中文，与历史 report 文案一致）。 */
export function buildNoFramesResolvedMessage(result: FrameResolveResult): string {
  if (result.requestedIds.length === 0) {
    return '请在左侧勾选至少一个要导出的 Frame。';
  }

  const lines: string[] = [
    `已选 ${result.requestedIds.length} 个目标，成功解析 ${result.frames.length} 个 Frame。`,
  ];

  if (result.missingIds.length > 0) {
    const sample = result.missingIds.slice(0, 3).join('、');
    const suffix =
      result.missingIds.length > 3 ? ` 等共 ${result.missingIds.length} 个` : '';
    lines.push(`未找到对应节点（可能已删除或 id 已过期）：${sample}${suffix}`);
  }

  if (result.wrongTypeIds.length > 0) {
    const sample = result.wrongTypeIds
      .slice(0, 2)
      .map((x) => `${x.id}(${x.type})`)
      .join('、');
    const suffix =
      result.wrongTypeIds.length > 2 ? ` 等共 ${result.wrongTypeIds.length} 个` : '';
    lines.push(`以下 id 不是 Frame 类型，无法导出：${sample}${suffix}`);
  }

  if (
    result.frames.length === 0 &&
    result.missingIds.length === 0 &&
    result.wrongTypeIds.length === 0
  ) {
    lines.push('请重新勾选左侧 Frame；若刚勾选完请稍候再试（需与主线程同步）。');
  }

  return lines.join(' ');
}
