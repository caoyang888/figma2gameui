function isConcreteFontName(value: unknown): value is FontName {

  return typeof value === 'object' && value !== null && 'family' in value && 'style' in value;

}



function canonicalizeFontPart(part: string): string {

  const trimmed = part.trim().replace(/\s+/g, ' ');

  try {

    return trimmed.normalize('NFC');

  } catch {

    return trimmed;

  }

}



/**
 * family 去重：忽略空格/连字符/大小写；并去掉 CJK 字体常见 2 字母注册后缀
 *（如 ChiuKong Gothic CL 与 ChiuKong Gothic MN 视为同一 family）。
 */
function normalizeFamilyForDedupe(family: string): string {
  let base = canonicalizeFontPart(family)
    .toLowerCase()
    .replace(/[\s\u00a0\u200b_-]+/g, '');
  base = base.replace(
    /(gothic|sans|serif|hei|song|kai|ming|yuan|round)(cl|mn|sc|tc|hk|jp|kr|cn|tw|pro|std)$/i,
    '$1',
  );
  return base;
}



function normalizeStyleTokenForDedupe(style: string): string {

  const token = canonicalizeFontPart(style).toLowerCase().replace(/[\s_-]+/g, '');

  return STYLE_DEDUPE_ALIASES[token] ?? token;

}



const STYLE_DEDUPE_ALIASES: Readonly<Record<string, string>> = {

  '': 'regular',

  normal: 'regular',

  regular: 'regular',

  book: 'regular',

  roman: 'regular',

  '400': 'regular',

  medium: 'medium',

  '500': 'medium',

  semibold: 'semibold',

  '600': 'semibold',

  demibold: 'semibold',

  bold: 'bold',

  '700': 'bold',

  heavy: 'bold',

  extrabold: 'bold',

  light: 'light',

  '300': 'light',

  thin: 'thin',

  '100': 'thin',

  black: 'black',

  '900': 'black',

};



/** 用于去重：忽略 family/style 大小写、family 空格/连字符差异，并合并常见 style 别名。 */

export function fontDedupeIdentityKey(storedKey: string): string {

  const normalized = normalizeFontKeyStored(storedKey);

  const pipe = normalized.lastIndexOf('|');

  const family = pipe >= 0 ? normalized.slice(0, pipe) : normalized;

  const style = pipe >= 0 ? normalized.slice(pipe + 1) : '';

  return `${normalizeFamilyForDedupe(family)}|${normalizeStyleTokenForDedupe(style)}`;

}



/** 规范 `Family|Style` 键（trim、NFC、合并空白），用于展示与持久化。 */

export function normalizeFontKeyFromParts(family: string, style: string): string {

  return `${canonicalizeFontPart(family)}|${canonicalizeFontPart(style)}`;

}



export function normalizeFontKeyStored(key: string): string {

  const pipe = key.lastIndexOf('|');

  if (pipe < 0) {

    return canonicalizeFontPart(key);

  }

  return normalizeFontKeyFromParts(key.slice(0, pipe), key.slice(pipe + 1));

}



/** 按语义去重并字典序排序（避免 UI 重复行）。 */

export function dedupeSortedFontKeys(keys: readonly string[]): string[] {

  const seen = new Set<string>();

  const out: string[] = [];

  for (const raw of keys) {

    const display = normalizeFontKeyStored(raw);

    if (display === '') {

      continue;

    }

    const id = fontDedupeIdentityKey(display);

    if (seen.has(id)) {

      continue;

    }

    seen.add(id);

    out.push(display);

  }

  return out.sort((a, b) => a.localeCompare(b));

}



function mappedAssetSignature(

  key: string,

  fontMap: Readonly<Record<string, string>>,

  fontUuidMap: Readonly<Record<string, string>>,

): string {

  const ttf = (fontMap[key] || '').trim().toLowerCase();

  const uuid = (fontUuidMap[key] || '').trim().toLowerCase();

  if (ttf === '' && uuid === '') {

    return '';

  }

  return `${ttf}\u0000${uuid}`;

}



/**

 * 已映射相同 TTF（及相同 UUID，若有）的多行合并为一行（用户已为两行选了同一文件时出现）。

 */

export function collapseFontKeysByMappedAsset(

  keys: readonly string[],

  fontMap: Readonly<Record<string, string>>,

  fontUuidMap: Readonly<Record<string, string>>,

): string[] {

  const deduped = dedupeSortedFontKeys(keys);

  const out: string[] = [];

  const seenAsset = new Set<string>();

  for (const key of deduped) {

    const sig = mappedAssetSignature(key, fontMap, fontUuidMap);

    if (sig !== '') {

      if (seenAsset.has(sig)) {

        continue;

      }

      seenAsset.add(sig);

    }

    out.push(key);

  }

  return out;

}



function mergeRecordValue<T>(prev: T | undefined, next: T): T {

  if (prev === undefined) {

    return next;

  }

  if (typeof next === 'string' && next.trim() !== '' && (typeof prev !== 'string' || prev.trim() === '')) {

    return next;

  }

  return prev;

}



/** 将 fontMap / uuidMap 的旧键名合并为规范键（按语义去重；冲突时保留非空值）。 */

export function remapFontRecord<T>(record: Record<string, T>): Record<string, T> {

  const byIdentity = new Map<string, { displayKey: string; value: T }>();

  for (const [rawKey, value] of Object.entries(record)) {

    const displayKey = normalizeFontKeyStored(rawKey);

    if (displayKey === '') {

      continue;

    }

    const id = fontDedupeIdentityKey(displayKey);

    const prev = byIdentity.get(id);

    if (!prev) {

      byIdentity.set(id, { displayKey, value });

      continue;

    }

    byIdentity.set(id, {

      displayKey: prev.displayKey,

      value: mergeRecordValue(prev.value, value),

    });

  }

  const out: Record<string, T> = {};

  for (const { displayKey, value } of byIdentity.values()) {

    out[displayKey] = value;

  }

  return out;

}



/** 仅保留 keys 列表中的条目，并按语义从旧 record 回填（合并别名键上的 TTF/UUID）。 */

export function alignFontRecordToKeys<T>(record: Record<string, T>, keys: readonly string[]): Record<string, T> {

  const remapped = remapFontRecord(record);

  const byIdentity = new Map<string, T>();

  for (const [k, v] of Object.entries(remapped)) {

    byIdentity.set(fontDedupeIdentityKey(k), v);

  }

  const out: Record<string, T> = {};

  for (const key of keys) {

    const id = fontDedupeIdentityKey(key);

    const hit = remapped[key] ?? byIdentity.get(id);

    if (hit !== undefined) {

      out[key] = hit;

    }

  }

  return out;

}



export type FontRegistry = {

  keys: string[];

  /** Figma / IR 可能出现的键 → UI 与 fontMap 使用的规范键 */

  aliasToCanonical: Record<string, string>;

};



class FontRegistryBuilder {

  private readonly byIdentity = new Map<string, string>();

  readonly aliasToCanonical: Record<string, string> = {};



  register(family: string, style: string): void {

    const display = normalizeFontKeyFromParts(family, style);

    const id = fontDedupeIdentityKey(display);

    let canonical = this.byIdentity.get(id);

    if (!canonical) {

      canonical = display;

      this.byIdentity.set(id, display);

    }

    const rawKey = `${family}|${style}`;

    this.aliasToCanonical[display] = canonical;

    this.aliasToCanonical[rawKey] = canonical;

    this.aliasToCanonical[normalizeFontKeyStored(rawKey)] = canonical;

  }



  build(): FontRegistry {

    return {

      keys: dedupeSortedFontKeys([...this.byIdentity.values()]),

      aliasToCanonical: { ...this.aliasToCanonical },

    };

  }

}



/** 将规范 fontMap 展开到 IR 中出现的别名键，便于导出按 Figma 原始 family|style 查找。 */

export function expandFontRecordByAliases<T>(

  record: Readonly<Record<string, T>>,

  aliasToCanonical: Readonly<Record<string, string>>,

): Record<string, T> {

  const out: Record<string, T> = { ...record };

  for (const [alias, canonical] of Object.entries(aliasToCanonical)) {

    const value = record[canonical];

    if (value !== undefined && out[alias] === undefined) {

      out[alias] = value;

    }

  }

  return out;

}



export function expandFontMapByAliases<T>(

  map: ReadonlyMap<string, T>,

  aliasToCanonical: Readonly<Record<string, string>>,

): Map<string, T> {

  const record: Record<string, T> = {};

  for (const [k, v] of map.entries()) {

    record[k] = v;

  }

  const expanded = expandFontRecordByAliases(record, aliasToCanonical);

  return new Map(Object.entries(expanded));

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



function collectMixedFontsFromText(text: TextNode, len: number, registry: FontRegistryBuilder): void {

  const withSegments = text as TextNode & {

    getStyledTextSegments?: (

      fields: ['fontName'],

    ) => ReadonlyArray<{ fontName: FontName | typeof figma.mixed }>;

  };

  if (typeof withSegments.getStyledTextSegments === 'function') {

    try {

      const segments = withSegments.getStyledTextSegments(['fontName']);

      for (const seg of segments) {

        if (isConcreteFontName(seg.fontName)) {

          registry.register(seg.fontName.family, seg.fontName.style);

        }

      }

      return;

    } catch {

      /* fallback */

    }

  }



  try {

    const all = text.getRangeAllFontNames(0, len);

    for (const f of all) {

      if (isConcreteFontName(f)) {

        registry.register(f.family, f.style);

      }

    }

  } catch {

    /* 忽略单段读取失败 */

  }

}



function collectFontsFromTextNode(text: TextNode, registry: FontRegistryBuilder): void {

  const fn = text.fontName;

  if (isConcreteFontName(fn)) {

    registry.register(fn.family, fn.style);

    return;

  }



  const chars = typeof text.characters === 'string' ? text.characters : '';

  const len = chars.length;

  if (len === 0) {

    return;

  }



  try {

    const mixed: unknown =

      typeof figma !== 'undefined' && 'mixed' in figma ? (figma as { mixed: unknown }).mixed : null;

    if (fn === mixed) {

      collectMixedFontsFromText(text, len, registry);

    }

  } catch {

    /* 忽略 */

  }

}



export function buildFontRegistryFromSceneSubtree(root: SceneNode): FontRegistry {

  const registry = new FontRegistryBuilder();

  walkSceneSubtree(root, (text) => {

    collectFontsFromTextNode(text, registry);

  });

  return registry.build();

}



export function buildFontRegistryFromExportFrames(frames: readonly FrameNode[]): FontRegistry {

  const registry = new FontRegistryBuilder();

  for (const frame of frames) {

    walkSceneSubtree(frame as unknown as SceneNode, (text) => {

      collectFontsFromTextNode(text, registry);

    });

  }

  return registry.build();

}



/** DFS: TEXT nodes contribute `Family|Style`; unique keys sorted lexicographically. */

export function collectFontKeysFromSceneSubtree(root: SceneNode): string[] {

  return buildFontRegistryFromSceneSubtree(root).keys;

}



/** 每个勾选 Frame 整棵子树扫描一次（不按嵌套 Export 根重复遍历）。 */

export function collectFontKeysFromExportSubtreesInFrames(frames: readonly FrameNode[]): string[] {

  return buildFontRegistryFromExportFrames(frames).keys;

}


