import { md5HexUtf8 } from './md5HexUtf8';

/**
 * 与 Creator `Editor.Utils.UUID.nameToSubId(name, 0)` 一致：对 UTF-8 名字做 MD5，取十六进制串的
 * 第 0、6、16、25、31 位字符组成 5 位小写十六进制子资源 id（见社区复刻 xyida/CocosCreatorUUIDUtils）。
 */
export function cocosNameToSubIdFromMd5Hex(md5Hex32: string): string {
  if (md5Hex32.length !== 32) {
    throw new Error('cocosNameToSubIdFromMd5Hex: expected 32-char md5 hex');
  }
  return (
    md5Hex32.charAt(0) +
    md5Hex32.charAt(6) +
    md5Hex32.charAt(16) +
    md5Hex32.charAt(25) +
    md5Hex32.charAt(31)
  );
}

export function cocosNameToSubId(name: string): string {
  return cocosNameToSubIdFromMd5Hex(md5HexUtf8(name));
}

/** plist `frames` 键（如 `foo.png`）→ Creator `sprite-frame` meta 的 `name`（去掉扩展名，与编辑器导入一致）。 */
export function plistStemForSpriteAtlasSubMetaName(plistFrameName: string): string {
  const base = plistFrameName.trim().replace(/\\/g, '/').split('/').pop() ?? plistFrameName.trim();
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

const RESERVED_SUB_IDS = new Set(['6c48a', 'f9941']);

/**
 * 为图集子图分配与 Creator 一致的 `subMetas` 键；若与保留 id 或其它帧冲突，则在名字后追加 `\\u0000`+salt 再哈希（极少触发）。
 */
export function allocateCocosSpriteAtlasSubMetaId(stem: string, used: Set<string>): string {
  for (let salt = 0; salt < 65536; salt += 1) {
    const input = salt === 0 ? stem : `${stem}\u0000${salt}`;
    const id = cocosNameToSubId(input);
    if (!RESERVED_SUB_IDS.has(id) && !used.has(id)) {
      used.add(id);
      return id;
    }
  }
  throw new Error('allocateCocosSpriteAtlasSubMetaId: exhausted collision space');
}
