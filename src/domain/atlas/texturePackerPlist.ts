import type { AtlasSpriteEntry } from './atlasLayout';

/**
 * 生成与 TexturePacker 兼容的 plist（XML），与合图 PNG 同目录、同名（.png → .plist）。
 * 坐标系：左上角为原点，y 向下，与管线 PNG / Cocos 导入约定一致。
 */

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function safeTextureFileName(name: string): string {
  const base = name.trim().replace(/\\/g, '/').split('/').pop() ?? 'atlas.png';
  return base.replace(/[<>:"|?*\u0000-\u001f]/g, '_') || 'atlas.png';
}

/**
 * 为 plist `frames` 字典生成唯一键名（尽量与源 asset 文件名一致，冲突时加 `_2` 后缀）。
 */
export function allocatePlistFrameName(assetRef: string, used: Set<string>): string {
  let name = assetRef.trim().replace(/\\/g, '/').split('/').pop() ?? 'sprite.png';
  name = name.replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim() || 'sprite.png';
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '.png';
  let key = stem + ext;
  let n = 2;
  while (used.has(key)) {
    key = `${stem}_${n}${ext}`;
    n += 1;
  }
  used.add(key);
  return key;
}

export type TexturePackerPlistFrame = {
  /** plist frames 字典中的键（通常为贴图文件名） */
  frameName: string;
  entry: AtlasSpriteEntry;
  /** 是否顺时针旋转 90° 写入图集；当前管线恒为 false */
  rotated?: boolean;
};

export function buildTexturePackerPlistXml(args: {
  /** 仅文件名，如 `atlas-0.png`（与 PNG 一致，便于同目录引用） */
  textureFileName: string;
  textureWidth: number;
  textureHeight: number;
  frames: readonly TexturePackerPlistFrame[];
}): string {
  const pngName = safeTextureFileName(args.textureFileName);
  const W = Math.round(args.textureWidth);
  const H = Math.round(args.textureHeight);

  const frameBlocks: string[] = [];
  for (const f of args.frames) {
    const { rect, sourceSize } = f.entry;
    const rot = f.rotated === true;
    const rx = Math.round(rect.x);
    const ry = Math.round(rect.y);
    const rw = Math.round(rect.width);
    const rh = Math.round(rect.height);
    const sw = Math.round(sourceSize.width);
    const sh = Math.round(sourceSize.height);
    const key = escapeXml(f.frameName);
    frameBlocks.push(`\t\t<key>${key}</key>
\t\t<dict>
\t\t\t<key>aliases</key>
\t\t\t<array/>
\t\t\t<key>spriteOffset</key>
\t\t\t<string>{0,0}</string>
\t\t\t<key>spriteSize</key>
\t\t\t<string>{${rw},${rh}}</string>
\t\t\t<key>spriteSourceSize</key>
\t\t\t<string>{${sw},${sh}}</string>
\t\t\t<key>textureRect</key>
\t\t\t<string>{{${rx},${ry}},{${rw},${rh}}}</string>
\t\t\t<key>textureRotated</key>
\t\t\t<${rot ? 'true' : 'false'}/>
\t\t</dict>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>frames</key>
\t<dict>
${frameBlocks.join('\n')}
\t</dict>
\t<key>metadata</key>
\t<dict>
\t\t<key>format</key>
\t\t<integer>3</integer>
\t\t<key>pixelFormat</key>
\t\t<string>RGBA8888</string>
\t\t<key>premultiplyAlpha</key>
\t\t<false/>
\t\t<key>realTextureFileName</key>
\t\t<string>${escapeXml(pngName)}</string>
\t\t<key>size</key>
\t\t<string>{${W},${H}}</string>
\t\t<key>smartupdate</key>
\t\t<string></string>
\t\t<key>textureFileName</key>
\t\t<string>${escapeXml(pngName)}</string>
\t</dict>
</dict>
</plist>
`;
}

/**
 * Creator 3.x / Cocos2d-x 常用的 **format 2** plist（与工程内 `sprite-atlas` 导入器、`metadata.format=2` 一致）。
 * 每帧字段：frame、offset、rotated、sourceColorRect、sourceSize。
 */
export function buildTexturePackerPlistFormat2Xml(args: {
  textureFileName: string;
  textureWidth: number;
  textureHeight: number;
  frames: readonly TexturePackerPlistFrame[];
}): string {
  const pngName = safeTextureFileName(args.textureFileName);
  const stem = pngName.replace(/\.[^.]+$/i, '') || 'atlas';
  const W = Math.round(args.textureWidth);
  const H = Math.round(args.textureHeight);

  const frameBlocks: string[] = [];
  for (const f of args.frames) {
    const { rect, sourceSize } = f.entry;
    const rx = Math.round(rect.x);
    const ry = Math.round(rect.y);
    const rw = Math.round(rect.width);
    const rh = Math.round(rect.height);
    const sw = Math.round(sourceSize.width);
    const sh = Math.round(sourceSize.height);
    const key = escapeXml(f.frameName);
    const ox = 0;
    const oy = 0;
    frameBlocks.push(`\t\t<key>${key}</key>
\t\t<dict>
\t\t\t<key>frame</key>
\t\t\t<string>{{${rx},${ry}},{${rw},${rh}}}</string>
\t\t\t<key>offset</key>
\t\t\t<string>{${ox},${oy}}</string>
\t\t\t<key>rotated</key>
\t\t\t<false/>
\t\t\t<key>sourceColorRect</key>
\t\t\t<string>{{0,0},{${sw},${sh}}}</string>
\t\t\t<key>sourceSize</key>
\t\t\t<string>{${sw},${sh}}</string>
\t\t</dict>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>frames</key>
\t<dict>
${frameBlocks.join('\n')}
\t</dict>
\t<key>metadata</key>
\t<dict>
\t\t<key>format</key>
\t\t<integer>2</integer>
\t\t<key>pixelFormat</key>
\t\t<string>RGBA8888</string>
\t\t<key>premultiplyAlpha</key>
\t\t<false/>
\t\t<key>realTextureFileName</key>
\t\t<string>${escapeXml(pngName)}</string>
\t\t<key>size</key>
\t\t<string>{${W},${H}}</string>
\t\t<key>textureFileName</key>
\t\t<string>${escapeXml(stem)}</string>
\t</dict>
</dict>
</plist>
`;
}
