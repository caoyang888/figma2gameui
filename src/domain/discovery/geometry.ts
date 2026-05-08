type Affine = [[number, number, number], [number, number, number]];

function multiplyAffine(a: Affine, b: Affine): Affine {
  const [[a0, c0, e0], [b0, d0, f0]] = a;
  const [[a1, c1, e1], [b1, d1, f1]] = b;
  return [
    [a0 * a1 + c0 * b1, a0 * c1 + c0 * d1, a0 * e1 + c0 * f1 + e0],
    [b0 * a1 + d0 * b1, b0 * c1 + d0 * d1, b0 * e1 + d0 * f1 + f0],
  ];
}

function invertAffine(t: Affine): Affine {
  const [[a, c, e], [b, d, f]] = t;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) {
    return [
      [1, 0, -e],
      [0, 1, -f],
    ];
  }
  const invDet = 1 / det;
  const ia = d * invDet;
  const ic = -c * invDet;
  const ib = -b * invDet;
  const id = a * invDet;
  const ie = -(ia * e + ic * f);
  const ify = -(ib * e + id * f);
  return [
    [ia, ic, ie],
    [ib, id, ify],
  ];
}

function applyAffine(t: Affine, x: number, y: number): { x: number; y: number } {
  const [[a, c, e], [b, d, f]] = t;
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

function bboxOfPoints(points: readonly { x: number; y: number }[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function placementFromTransforms(
  frame: FrameNode,
  exportRoot: SceneNode,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  const frameT = frame.absoluteTransform as Affine;
  const rootT = exportRoot.absoluteTransform as Affine;
  const rel = multiplyAffine(invertAffine(frameT), rootT);
  const corners: { x: number; y: number }[] = [
    applyAffine(rel, 0, 0),
    applyAffine(rel, width, 0),
    applyAffine(rel, width, height),
    applyAffine(rel, 0, height),
  ];
  return bboxOfPoints(corners);
}

function readBox(
  node: SceneNode,
): { x: number; y: number; width: number; height: number } | null {
  const box = node.absoluteBoundingBox;
  if (!box) {
    return null;
  }
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

/**
 * Export root axis-aligned bounds in the frame's local coordinate space.
 * Prefers `absoluteBoundingBox` delta; otherwise derives from `absoluteTransform` and layout size.
 */
export function getExportRootPlacementInFrame(
  frame: FrameNode,
  exportRoot: SceneNode,
): { x: number; y: number; width: number; height: number } {
  const frameBox = readBox(frame);
  const rootBox = readBox(exportRoot);
  if (frameBox && rootBox) {
    return {
      x: rootBox.x - frameBox.x,
      y: rootBox.y - frameBox.y,
      width: rootBox.width,
      height: rootBox.height,
    };
  }

  const w = 'width' in exportRoot ? Number(exportRoot.width) : 0;
  const h = 'height' in exportRoot ? Number(exportRoot.height) : 0;
  return placementFromTransforms(frame, exportRoot, w, h);
}
