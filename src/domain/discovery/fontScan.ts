import { discoverExportNodesInFrame } from './exportDiscovery';

function isConcreteFontName(value: unknown): value is FontName {
  return typeof value === 'object' && value !== null && 'family' in value && 'style' in value;
}

function walkSceneSubtree(node: SceneNode, onText: (n: TextNode) => void): void {
  if (node.type === 'TEXT') {
    onText(node);
  }
  if ('children' in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      walkSceneSubtree(child, onText);
    }
  }
}

/** DFS: TEXT nodes contribute `Family|Style`; unique keys sorted lexicographically. */
export function collectFontKeysFromSceneSubtree(root: SceneNode): string[] {
  const keys = new Set<string>();
  walkSceneSubtree(root, (text) => {
    const fn = text.fontName;
    if (isConcreteFontName(fn)) {
      keys.add(`${fn.family}|${fn.style}`);
    }
  });
  return [...keys].sort((a, b) => a.localeCompare(b));
}

/** For each selected frame, each export-settings root subtree; union of font keys, sorted unique. */
export function collectFontKeysFromExportSubtreesInFrames(frames: readonly FrameNode[]): string[] {
  const keys = new Set<string>();
  for (const frame of frames) {
    for (const exportRoot of discoverExportNodesInFrame(frame)) {
      for (const k of collectFontKeysFromSceneSubtree(exportRoot)) {
        keys.add(k);
      }
    }
  }
  return [...keys].sort((a, b) => a.localeCompare(b));
}
