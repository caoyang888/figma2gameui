import type { OutputFile } from '../../shared/types';

export type ExportFileWire = {
  path: string;
  data: number[];
};

export function filesToWire(files: readonly OutputFile[]): ExportFileWire[] {
  return files.map((f) => ({
    path: f.path,
    data: Array.from(f.data),
  }));
}
