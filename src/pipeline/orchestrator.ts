import type { AtlasLayout } from '../domain/atlas/atlasLayout';
import type { ExportSettings } from './context';
import { createBinPackRasterizer } from './atlas/binPackAndRasterize';
import { packAtlases } from './atlas/packAtlases';
import { ReportCollector } from './report';
import { ProgressReporter } from './progress';
import { validateAssetsRelativeRoot } from '../shared/pathValidation';
import { resolveFramesByIds } from '../domain/discovery/selection';
import { tryExportPng } from '../domain/raster/raster';
import { annotateExportTree, collectNodesToHideForExport, collectRasterNodes } from '../domain/discovery/annotate';
import { buildFrameIr, exportAssetRefForNodeId } from '../domain/ir/builder';
import { dedupeTexturesByBytesInPlace } from '../domain/ir/transforms/dedupeTextures';
import { applyConstraintFitMetadata } from '../domain/constraints/apply';
import { stripConstraintsFromIr, stripFigmaAutoLayoutFromIr } from './layoutExportPolicy';
import { EmitterRegistry } from '../domain/emitters/registry';
import { TransformRegistry, type FeatureGate } from '../domain/ir/transforms/registry';
import { filesToWire, type ExportFileWire } from '../domain/packaging/packager';
import { IR_VERSION, type IR, type IrFrame, type IrNode } from '../domain/ir/schema';
import type { OutputFile } from '../shared/types';
import type { TexturePayload } from '../shared/hash';
import { encodeUtf8 } from '../shared/utf8';
import { readPngIhdrDimensions } from '../shared/pngDimensions';
import {
  buildTextureGroupsDocument,
  exportNodeIdFromSpriteIr,
  serializeTextureGroupsDocument,
} from './textureGroups';

export type SpriteLikeIrRefRow = {
  assetRef: string;
  spriteId: string;
  frameId: string;
  frameName: string;
};

function walkIrForSpriteLike(nodes: readonly IrNode[], frameId: string, frameName: string, out: SpriteLikeIrRefRow[]): void {
  for (const n of nodes) {
    if (n.kind === 'sprite' || n.kind === 'slicedSprite') {
      out.push({ assetRef: n.assetRef, spriteId: n.id, frameId, frameName });
    }
    if (n.kind === 'container' || n.kind === 'mask') {
      walkIrForSpriteLike(n.children, frameId, frameName, out);
    }
  }
}

/** 扫描 IR 中所有 `sprite` / `slicedSprite` 的规范 `assetRef` 与节点 id（供贴图分组）。 */
export function collectSpriteLikeRefsInIr(ir: IR): SpriteLikeIrRefRow[] {
  const out: SpriteLikeIrRefRow[] = [];
  for (const f of ir.frames) {
    walkIrForSpriteLike(f.children, f.id, f.name, out);
  }
  return out;
}

/** 自导出节点父级起至导出 Frame（含 Frame 自身 name，作为链末）的 name 列表，供 `@g:` 自下而上解析。 */
function collectAncestorNamesUpToFrame(exportNode: SceneNode, frameId: string): string[] {
  const names: string[] = [];
  let p: BaseNode | null = exportNode.parent;
  while (p !== null) {
    if (p.id === frameId) {
      if ('name' in p && typeof (p as { name?: unknown }).name === 'string') {
        names.push((p as { name: string }).name);
      }
      break;
    }
    if ('name' in p && typeof (p as { name?: unknown }).name === 'string') {
      names.push((p as { name: string }).name);
    }
    p = p.parent;
  }
  return names;
}

function isTraversableSceneNodeForExport(node: BaseNode | null): node is SceneNode {
  return (
    node !== null &&
    'parent' in node &&
    'name' in node &&
    typeof (node as { name?: unknown }).name === 'string' &&
    node.type !== 'DOCUMENT' &&
    node.type !== 'PAGE'
  );
}

export type OrchestratorDeps = {
  emitterRegistry: EmitterRegistry;
  transformRegistry: TransformRegistry;
  featureGate: FeatureGate;
};

/**
 * transform 之后、emitter 之前：按导出设置决定是否调用 `packAtlases`，返回供 emitter 使用的贴图映射与可选 `atlasLayout`。
 * 导出供单测断言「未开启合图时不调用 packAtlases」等行为。
 */
export async function resolveTexturesForEmitterAfterTransform(input: {
  settings: ExportSettings;
  transformedIr: IR;
  textureByAssetRef: Map<string, TexturePayload>;
  primaryGroupByAssetRef: Record<string, string>;
  report: ReportCollector;
}): Promise<{ textureByAssetRef: Map<string, TexturePayload>; atlasLayout?: AtlasLayout }> {
  const { settings, transformedIr, textureByAssetRef, primaryGroupByAssetRef, report } = input;
  let texturesForEmit = textureByAssetRef;
  let atlasLayout: AtlasLayout | undefined;

  const shouldPack =
    settings.atlasPackingRequested &&
    settings.atlasPackingAuthorized &&
    settings.includeTextures !== false;

  if (!shouldPack) {
    return { textureByAssetRef: texturesForEmit, atlasLayout };
  }

  const primaryMap = new Map<string, string>(Object.entries(primaryGroupByAssetRef));
  let packed:
    | {
      layout: AtlasLayout;
      textureByAssetRef: Map<string, TexturePayload>;
    }
    | undefined;
  try {
    packed = await packAtlases({
      ir: transformedIr,
      textureByAssetRef,
      primaryGroupByAssetRef: primaryMap,
      atlasMaxSide: settings.atlasMaxSide,
      atlasLargeSpriteAreaRatioThreshold: settings.atlasLargeSpriteAreaRatioThreshold,
      packBucket: createBinPackRasterizer({ atlasMaxSide: settings.atlasMaxSide }),
      report,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    report.add('warning', `图集打包失败，已回退为散图导出：${message}`);
    return { textureByAssetRef: texturesForEmit, atlasLayout };
  }

  if (packed) {
    texturesForEmit = packed.textureByAssetRef;
    atlasLayout = packed.layout;
    report.add('info', `图集合图：共 ${packed.layout.pages.length} 张 atlas 页。`);
  }

  return { textureByAssetRef: texturesForEmit, atlasLayout };
}

export type ExportResult = {
  ok: boolean;
  report: import('../shared/types').ReportEntry[];
  files: ExportFileWire[];
};

function nodeSize(node: SceneNode): { width: number; height: number } {
  if ('width' in node && 'height' in node) return { width: Number(node.width), height: Number(node.height) };
  const withBb = node as SceneNode & { absoluteBoundingBox?: { width: number; height: number } | null };
  if (withBb.absoluteBoundingBox) return { width: Number(withBb.absoluteBoundingBox.width), height: Number(withBb.absoluteBoundingBox.height) };
  return { width: 0, height: 0 };
}

export async function runExportPipeline(
  frameIds: readonly string[],
  settings: ExportSettings,
  deps: OrchestratorDeps,
  progress: ProgressReporter,
): Promise<ExportResult> {
  const report = new ReportCollector();
  const outputFiles: OutputFile[] = [];

  try {
    // Stage 1: validate paths
    progress.report('校验导出路径…', 0.02);
    const exportRoot = validateAssetsRelativeRoot(
      settings.assetsRootRelative.trim() !== '' ? settings.assetsRootRelative : '_figma_export',
    );
    const prefabRel = validateAssetsRelativeRoot(settings.prefabsRelativeDir);
    const textureRel = validateAssetsRelativeRoot(settings.texturesRelativeDir);
    const fontRel = validateAssetsRelativeRoot(settings.fontsRelativeDir);

    if (!settings.includePrefabs && !settings.includeTextures && !settings.includeFonts) {
      throw new Error('请至少勾选一种导出内容（预制体/图片/字体）。');
    }

    // Stage 2: resolve frames
    progress.report('检查导出目标…', 0.06);
    const frames = resolveFramesByIds(frameIds);

    if (frames.length === 0) {
      report.add('error', '请在左侧勾选至少一个要导出的 Frame。');
      return { ok: false, report: report.sortForDisplay(), files: filesToWire(outputFiles) };
    }

    report.add('info', `已勾选 ${frames.length} 个 Frame。`);

    // Stage 3: annotate + discover raster nodes
    const frameAnnotations: { frameNode: FrameNode; roles: ReadonlyMap<string, import('../domain/discovery/annotate').NodeRole>; rasterNodes: SceneNode[] }[] = [];
    let rasterTotal = 0;

    for (const frame of frames) {
      const roles = annotateExportTree(frame);
      const rasterNodes = collectRasterNodes(frame, roles);
      frameAnnotations.push({ frameNode: frame, roles, rasterNodes });
      for (const node of rasterNodes) {
        const { width, height } = nodeSize(node);
        if (width > 0 && height > 0) rasterTotal += 1;
      }
    }

    // Stage 4: rasterize PNGs + Stage 5: build IR per frame
    const textureByAssetRef = new Map<string, TexturePayload>();
    const irFrames: IrFrame[] = [];
    let rasterDone = 0;

    for (const { frameNode, roles, rasterNodes } of frameAnnotations) {
      if (rasterNodes.length === 0) {
        report.add('error', `Frame「${frameNode.name}」内未找到带导出设置的节点。`, frameNode.id);
        continue;
      }

      for (const node of rasterNodes) {
        const logical = nodeSize(node);
        if (logical.width <= 0 || logical.height <= 0) {
          report.add('info', `已跳过 0 尺寸节点: ${node.name}`, node.id);
          continue;
        }
        let texW = Math.max(1, Math.round(logical.width));
        let texH = Math.max(1, Math.round(logical.height));
        const ratio = rasterTotal > 0 ? 0.08 + 0.62 * (rasterDone / rasterTotal) : 0.35;
        progress.report(`导出贴图 · ${frameNode.name} / ${node.name}`, ratio);

        const toHide = collectNodesToHideForExport(node, roles);
        for (const t of toHide) { (t as SceneNode & { visible: boolean }).visible = false; }
        try {
          const bytes = await tryExportPng(node, report);
          if (bytes) {
            const ref = exportAssetRefForNodeId(node.id);
            const fromPng = readPngIhdrDimensions(bytes);
            if (fromPng) {
              if (fromPng.width !== texW || fromPng.height !== texH) {
                report.add(
                  'info',
                  `贴图 PNG 实际尺寸 ${fromPng.width}×${fromPng.height} 与节点边界 ${texW}×${texH} 不一致，已以 PNG 为准`,
                  node.id,
                );
              }
              texW = fromPng.width;
              texH = fromPng.height;
            } else if (bytes.length >= 2 && bytes[0] === 0x89 && bytes[1] === 0x50) {
              report.add(
                'warning',
                'PNG 头有效但无法读取 IHDR，贴图尺寸仍用节点边界（若引擎里出现黑边/错位，请检查导出预设）',
                node.id,
              );
            }
            textureByAssetRef.set(ref, { bytes, width: texW, height: texH });
          }
        } finally {
          for (const t of toHide) { (t as SceneNode & { visible: boolean }).visible = true; }
        }
        rasterDone += 1;
      }

      irFrames.push(buildFrameIr(frameNode, roles, report));
      progress.report(
        `构建预制体 · ${frameNode.name}`,
        0.72 + 0.1 * (irFrames.length / Math.max(1, frames.length)),
      );
    }

    // Build full IR document
    let fileKey = '';
    try { fileKey = figma.fileKey ?? ''; } catch { /* sandbox guard */ }
    const ir: IR = {
      version: IR_VERSION,
      generatedAt: new Date().toISOString(),
      sourceFileKey: fileKey,
      frames: irFrames,
    };

    // Stage 5.5: optional constraints → widget / fit 元数据（与导出开关一致）
    if (settings.exportConstraintsEnabled) {
      applyConstraintFitMetadata(ir, report);
    } else {
      stripConstraintsFromIr(ir);
    }
    if (!settings.exportFigmaAutoLayoutEnabled) {
      stripFigmaAutoLayoutFromIr(ir);
    }

    // Stage 6: dedupe textures
    if (textureByAssetRef.size > 0) {
      progress.report('合并重复贴图（按 PNG 字节）…', 0.78);
      await dedupeTexturesByBytesInPlace(ir, textureByAssetRef, report);
    }

    if (irFrames.length === 0) {
      return { ok: false, report: report.sortForDisplay(), files: filesToWire(outputFiles) };
    }

    const textureAssetRefs = [...textureByAssetRef.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const spriteRowsByAssetRef = new Map<string, SpriteLikeIrRefRow[]>();
    for (const row of collectSpriteLikeRefsInIr(ir)) {
      const list = spriteRowsByAssetRef.get(row.assetRef) ?? [];
      list.push(row);
      spriteRowsByAssetRef.set(row.assetRef, list);
    }

    const manualTextureGroupByExportNodeId = settings.manualTextureGroupByExportNodeId ?? new Map<string, string>();
    const primaryGroupByAssetRef: Record<string, string> = {};

    if (textureByAssetRef.size > 0) {
      const firstFrame = ir.frames[0];
      const resolveRows = (assetRef: string) => {
        const collected = spriteRowsByAssetRef.get(assetRef) ?? [];
        if (collected.length === 0) {
          report.add('warning', '贴图无 IR 引用仍写入分组', assetRef);
          return [
            {
              exportNodeId: '',
              exportNodeName: '',
              ancestorNamesUpToFrame: [] as const,
              frameName: firstFrame.name,
              frameId: firstFrame.id,
            },
          ];
        }
        return collected.map((r) => {
          const exportNodeId = exportNodeIdFromSpriteIr(r.spriteId);
          const gn = figma.getNodeById(exportNodeId);
          if (!isTraversableSceneNodeForExport(gn)) {
            report.add(
              'warning',
              `找不到导出节点或无法解析层级，已按 Frame 默认分组（id=${exportNodeId}）`,
              exportNodeId || r.spriteId,
            );
            return {
              exportNodeId,
              exportNodeName: '',
              ancestorNamesUpToFrame: [] as const,
              frameName: r.frameName,
              frameId: r.frameId,
            };
          }
          return {
            exportNodeId,
            exportNodeName: gn.name,
            ancestorNamesUpToFrame: collectAncestorNamesUpToFrame(gn, r.frameId),
            frameName: r.frameName,
            frameId: r.frameId,
          };
        });
      };

      const textureGroupsDoc = buildTextureGroupsDocument({
        textureAssetRefs,
        subdirByPrimaryGroup: settings.textureSubdirByPrimaryGroup,
        policy: 'frame_then_naming',
        generatedAt: ir.generatedAt,
        manualByExportNodeId: manualTextureGroupByExportNodeId,
        resolveRows,
      });

      for (const e of textureGroupsDoc.entries) {
        primaryGroupByAssetRef[e.assetRef] = e.primaryGroup;
        if (e.groups.length > 1) {
          report.add(
            'info',
            `贴图被多个逻辑组引用，primaryGroup 已取字典序最小的组：${e.primaryGroup}（${e.assetRef}）`,
            e.assetRef,
          );
        }
      }

      const tgBytes = serializeTextureGroupsDocument(textureGroupsDoc);
      outputFiles.push({ path: `assets/${exportRoot}/debug/texture-groups.json`, data: tgBytes });
    }

    // Stage 7: transform chain
    const transformCtx = { settings: settings.engineSpecific, report, engineId: settings.engineId };
    const transformedIr = deps.transformRegistry.execute(ir, transformCtx, deps.featureGate);

    const { textureByAssetRef: textureMapForEmit, atlasLayout } = await resolveTexturesForEmitterAfterTransform({
      settings,
      transformedIr,
      textureByAssetRef,
      primaryGroupByAssetRef,
      report,
    });

    // Stage 7b: emit via engine emitter
    progress.report('写入引擎文件…', 0.85);
    const emitter = deps.emitterRegistry.get(settings.engineId);
    if (!emitter) {
      throw new Error(`Unknown engine: ${settings.engineId}`);
    }

    const widgetRootFillScreen =
      settings.exportConstraintsEnabled === true && settings.widgetRootFillScreen === true;

    const emitted = emitter.emit({
      ir: transformedIr,
      settings: {
        assetsRootRelative: exportRoot,
        prefabsRelativeDir: prefabRel,
        texturesRelativeDir: textureRel,
        fontsRelativeDir: fontRel,
        textureByAssetRef: textureMapForEmit,
        fontByKey: settings.fontFiles,
        fontUuidOverrideByKey: settings.fontUuidOverrides,
        includePrefabs: settings.includePrefabs,
        includeTextures: settings.includeTextures,
        includeFonts: settings.includeFonts,
        primaryGroupByAssetRef,
        textureSubdirByPrimaryGroup: settings.textureSubdirByPrimaryGroup,
        ...(widgetRootFillScreen ? { widgetRootFillScreen: true } : {}),
        ...(atlasLayout !== undefined ? { atlasLayout } : {}),
      },
      engineVersion: settings.engineVersion,
    });

    for (const w of emitted.warnings) {
      report.add(w.level, w.message, w.nodeId);
    }
    outputFiles.push(...emitted.files);

    if (settings.attachDebugIr) {
      const irJson = JSON.stringify(transformedIr, null, 2);
      const irBytes = encodeUtf8(irJson);
      outputFiles.push({ path: `assets/${exportRoot}/debug/ir.json`, data: irBytes });
    }

    progress.report('完成', 1);
    return { ok: true, report: report.sortForDisplay(), files: filesToWire(outputFiles) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    report.add('error', `导出失败: ${message}`);
    return { ok: false, report: report.sortForDisplay(), files: filesToWire(outputFiles) };
  }
}
