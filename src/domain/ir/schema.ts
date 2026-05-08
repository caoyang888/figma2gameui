import type { ErrorMetrics, FitQuality } from '../constraints/model';

export const IR_VERSION = 'figma-ui-ir/2' as const;

export type IrPlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
};

export type IrColor = { r: number; g: number; b: number; a: number };

export type IrLayoutFlex = {
  type: 'flex';
  direction: 'row' | 'column';
  gap: number;
  padding: { left: number; right: number; top: number; bottom: number };
};

export type IrLayout = IrLayoutFlex;

export type IrExtensions = {
  [namespace: string]: unknown;
};

export type IrNodeBase = {
  id: string;
  name: string;
  placement: IrPlacement;
  opacity: number;
  visible: boolean;
  layout?: IrLayout;
  fitQuality?: FitQuality;
  reasonCode?: string;
  errorMetrics?: ErrorMetrics;
  extensions: IrExtensions;
};

export type IrContainer = IrNodeBase & {
  kind: 'container';
  children: IrNode[];
};

export type IrSprite = IrNodeBase & {
  kind: 'sprite';
  assetRef: string;
};

export type IrText = IrNodeBase & {
  kind: 'text';
  characters: string;
  fontFamily: string;
  fontStyle: string;
  fontSize: number;
  color?: IrColor;
  /** Figma 文本可见描边（首条可见 SOLID）；未设置表示无描边。 */
  outline?: { width: number; color: IrColor };
};

export type IrSlicedSprite = IrNodeBase & {
  kind: 'slicedSprite';
  assetRef: string;
  slices: { top: number; bottom: number; left: number; right: number };
};

export type IrMask = IrNodeBase & {
  kind: 'mask';
  children: IrNode[];
};

export type IrNode = IrContainer | IrSprite | IrText | IrSlicedSprite | IrMask;

export type IrAsset = {
  ref: string;
  kind: 'texture' | 'font';
  originalName: string;
  data: Uint8Array;
  hash: string;
};

export type IrFrame = {
  id: string;
  name: string;
  width: number;
  height: number;
  children: IrNode[];
  assets: IrAsset[];
};

export type IR = {
  version: typeof IR_VERSION;
  generatedAt: string;
  sourceFileKey: string;
  frames: IrFrame[];
};
