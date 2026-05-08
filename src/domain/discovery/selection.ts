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

/**
 * Resolves persisted frame ids to live `FrameNode`s (skips missing or wrong types).
 * Order follows `ids` with de-duplication.
 */
export function resolveFramesByIds(ids: readonly string[]): FrameNode[] {
  const out: FrameNode[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const n = figma.getNodeById(id);
    if (n && n.type === 'FRAME') {
      out.push(n);
    }
  }
  return out;
}
