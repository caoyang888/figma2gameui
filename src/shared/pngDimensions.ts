/**
 * 从 PNG 字节读取 IHDR 中的像素宽高（不整图解码）。
 * 标准 PNG 的第一个 chunk 恒为 IHDR，宽在偏移 16、高在 20（大端 u32）。
 */
export function readPngIhdrDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.byteLength < 24) return undefined;
  const b0 = bytes[0] ?? 0;
  const b1 = bytes[1] ?? 0;
  const b2 = bytes[2] ?? 0;
  const b3 = bytes[3] ?? 0;
  if (b0 !== 0x89 || b1 !== 0x50 || b2 !== 0x4e || b3 !== 0x47) return undefined;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = dv.getUint32(16, false);
  const height = dv.getUint32(20, false);
  if (width === 0 || height === 0 || width > 16384 || height > 16384) return undefined;
  return { width, height };
}
