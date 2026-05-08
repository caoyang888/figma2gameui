/**
 * Cocos Creator 3.8.x 风格的主资源 uuid（标准 UUID v4，36 字符）与最小 `.meta` JSON。
 * 参考：用户提供的 3.8.0 PNG meta 实例 + 3.8.x 基础导出兼容目标。
 */

export type MetaAssetKind = 'Texture2D' | 'TTFFont' | 'Prefab';

export type MakeMetaFileParams = {
  uuid: string;
  kind: MetaAssetKind;
  /** 磁盘上的主文件名（须含扩展名），用于 `files` 第二项；Prefab 可省略。 */
  fileName?: string;
  /** Prefab meta 的 `userData.syncNodeName`。 */
  syncNodeName?: string;
  /** 覆盖默认 `importer`（一般不传）。 */
  importer?: string;
  /** 导出目标版本（3.8.x 统一走同一套 profile）。 */
  engineVersion?: string;
};

type MetaVersionProfile = {
  prefabVer: string;
  ttfVer: string;
  imageVer: string;
  textureSubMetaVer: string;
  spriteFrameSubMetaVer: string;
};

const META_PROFILE_38X: MetaVersionProfile = {
  // 用户工程实测：3.8.0 prefab meta 默认 1.1.45
  prefabVer: '1.1.45',
  ttfVer: '1.0.1',
  imageVer: '1.0.26',
  textureSubMetaVer: '1.0.22',
  spriteFrameSubMetaVer: '1.0.12',
};

function resolveMetaVersionProfile(engineVersion?: string): MetaVersionProfile {
  if (engineVersion?.startsWith('3.8')) return META_PROFILE_38X;
  // 当前插件仅支持 3.8.x；其他值回退到 3.8.x profile。
  return META_PROFILE_38X;
}

function bytesToUuidV4(bytes: Uint8Array): string {
  const h = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** 生成 Creator 3.x `.meta` 使用的标准 UUID v4（小写十六进制 + 连字符）。 */
export function newUuid(): string {
  const bytes = new Uint8Array(16);
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = (Math.random() * 256) | 0;
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return bytesToUuidV4(bytes);
}

function stringifyMeta(obj: unknown): string {
  return `${JSON.stringify(obj, null, 2)}\n`;
}

/**
 * 生成最小可用的 `.meta` 文本（UTF-8 JSON）。
 * `Texture2D` 对应 `importer: "image"`；`TTFFont` 对应 `ttf-font`；`Prefab` 对应 `prefab`。
 */
export function makeMetaFile(params: MakeMetaFileParams): string {
  const { uuid, kind } = params;
  const profile = resolveMetaVersionProfile(params.engineVersion);
  switch (kind) {
    case 'Prefab': {
      const importer = params.importer ?? 'prefab';
      const syncName = params.syncNodeName ?? 'root';
      return stringifyMeta({
        ver: profile.prefabVer,
        importer,
        imported: true,
        uuid,
        files: ['.json'],
        subMetas: {},
        userData: {
          syncNodeName: syncName,
        },
      });
    }
    case 'TTFFont': {
      const fileName = params.fileName;
      if (!fileName || !fileName.toLowerCase().endsWith('.ttf')) {
        throw new Error('makeMetaFile(TTFFont): fileName must end with .ttf');
      }
      return stringifyMeta({
        ver: profile.ttfVer,
        importer: params.importer ?? 'ttf-font',
        imported: true,
        uuid,
        files: ['.json', fileName],
        subMetas: {},
        userData: {},
      });
    }
    case 'Texture2D': {
      const fileName = params.fileName ?? '.png';
      return stringifyMeta({
        ver: profile.imageVer,
        importer: params.importer ?? 'image',
        imported: true,
        uuid,
        files: ['.json', fileName],
        subMetas: {},
        userData: {
          type: 'sprite-frame',
          fixAlphaTransparencyArtifacts: true,
          hasAlpha: true,
        },
      });
    }
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/**
 * 散图 sprite-frame：整张贴图像素 UV + 归一化 UV（无半像素内缩）；纹理过滤用 linear，与 `fixAlphaTransparencyArtifacts` 减轻透明边发黑。
 */
function spriteUvPixelsFull(width: number, height: number): number[] {
  const W = width;
  const H = height;
  return [0, H, W, H, 0, 0, W, 0];
}

function spriteNuvFull(): number[] {
  return [0, 0, 1, 0, 0, 1, 1, 1];
}

/**
 * Creator 3.x `image` 导入器用 PNG `.meta`（含默认 `sprite-frame` 子资源），供 Prefab 中 `__uuid__` 引用。
 */
export function makeImageImporterMeta(params: {
  textureUuid: string;
  spriteUuid: string;
  fileName: string;
  width: number;
  height: number;
  engineVersion?: string;
}): string {
  const { textureUuid, spriteUuid, fileName, width, height, engineVersion } = params;
  const profile = resolveMetaVersionProfile(engineVersion);
  const texSubId = '6c48a';
  const shortId = 'f9941';
  const displayName = fileName.replace(/\.[^.]+$/, '') || 'sprite';
  const hw = width / 2;
  const hh = height / 2;
  const vertices = {
    rawPosition: [-hw, -hh, 0, hw, -hh, 0, -hw, hh, 0, hw, hh, 0],
    indexes: [0, 1, 2, 2, 1, 3],
    uv: spriteUvPixelsFull(width, height),
    nuv: spriteNuvFull(),
    minPos: [-hw, -hh, 0],
    maxPos: [hw, hh, 0],
  };
  const obj = {
    ver: profile.imageVer,
    importer: 'image',
    imported: true,
    uuid: textureUuid,
    files: ['.json', '.png'],
    subMetas: {
      [texSubId]: {
        importer: 'texture',
        uuid: `${textureUuid}@${texSubId}`,
        displayName,
        id: texSubId,
        name: 'texture',
        userData: {
          wrapModeS: 'clamp-to-edge',
          wrapModeT: 'clamp-to-edge',
          imageUuidOrDatabaseUri: textureUuid,
          isUuid: true,
          visible: false,
          minfilter: 'linear',
          magfilter: 'linear',
          mipfilter: 'none',
          anisotropy: 0,
        },
        ver: profile.textureSubMetaVer,
        imported: true,
        files: ['.json'],
        subMetas: {},
      },
      [shortId]: {
        importer: 'sprite-frame',
        uuid: spriteUuid,
        displayName,
        id: shortId,
        name: 'spriteFrame',
        userData: {
          trimThreshold: 1,
          rotated: false,
          offsetX: 0,
          offsetY: 0,
          trimX: 0,
          trimY: 0,
          width,
          height,
          rawWidth: width,
          rawHeight: height,
          borderTop: 0,
          borderBottom: 0,
          borderLeft: 0,
          borderRight: 0,
          packable: true,
          pixelsToUnit: 100,
          pivotX: 0.5,
          pivotY: 0.5,
          meshType: 0,
          vertices,
          isUuid: true,
          imageUuidOrDatabaseUri: `${textureUuid}@${texSubId}`,
          atlasUuid: '',
          trimType: 'auto',
        },
        ver: profile.spriteFrameSubMetaVer,
        imported: true,
        files: ['.json'],
        subMetas: {},
      },
    },
    userData: {
      type: 'sprite-frame',
      hasAlpha: true,
      fixAlphaTransparencyArtifacts: true,
      redirect: `${textureUuid}@${shortId}`,
    },
  };
  return `${JSON.stringify(obj, null, 2)}\n`;
}
