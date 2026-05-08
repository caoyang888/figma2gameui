function hexFromBuffer(buf: ArrayBuffer): string {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i++) {
    s += u[i]!.toString(16).padStart(2, '0');
  }
  return s;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('SHA-256 需要 crypto.subtle（当前环境不可用）。');
  }
  const digest = await subtle.digest('SHA-256', bytes);
  return hexFromBuffer(digest);
}

export type TexturePayload = { bytes: Uint8Array; width: number; height: number };

/** Build ref → canonical ref（同字节内容合并；规范 ref 为同组内字典序最小）。 */
export async function buildTextureRefCanonicalMap(
  textureByAssetRef: ReadonlyMap<string, TexturePayload>,
): Promise<Map<string, string>> {
  const entries = [...textureByAssetRef.entries()];
  if (entries.length === 0) {
    return new Map();
  }

  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digests = await Promise.all(entries.map(([, p]) => sha256Hex(p.bytes)));
    const hashToRefs = new Map<string, string[]>();
    for (let i = 0; i < entries.length; i++) {
      const h = digests[i]!;
      const ref = entries[i]![0];
      let list = hashToRefs.get(h);
      if (!list) {
        list = [];
        hashToRefs.set(h, list);
      }
      list.push(ref);
    }
    const refToCanon = new Map<string, string>();
    for (const refs of hashToRefs.values()) {
      refs.sort((a, b) => a.localeCompare(b));
      const canon = refs[0]!;
      for (const r of refs) {
        refToCanon.set(r, canon);
      }
    }
    return refToCanon;
  }

  const clusters: Array<{ bytes: Uint8Array; refs: string[] }> = [];
  for (const [ref, payload] of entries) {
    let found = -1;
    for (let i = 0; i < clusters.length; i++) {
      if (bytesEqual(payload.bytes, clusters[i]!.bytes)) {
        found = i;
        break;
      }
    }
    if (found < 0) {
      clusters.push({ bytes: payload.bytes, refs: [ref] });
    } else {
      clusters[found]!.refs.push(ref);
    }
  }
  const refToCanon = new Map<string, string>();
  for (const { refs } of clusters) {
    refs.sort((a, b) => a.localeCompare(b));
    const canon = refs[0]!;
    for (const r of refs) {
      refToCanon.set(r, canon);
    }
  }
  return refToCanon;
}
