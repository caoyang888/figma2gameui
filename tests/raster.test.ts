import { describe, it, expect } from 'vitest';
import { ReportCollector } from '../src/pipeline/report';
import { getPreferredExportConstraint, tryExportPng } from '../src/domain/raster/raster';

function mockExportNode(exportSettings: ReadonlyArray<ExportSettings>): SceneNode & ExportMixin {
  return { exportSettings } as SceneNode & ExportMixin;
}

describe('getPreferredExportConstraint', () => {
  it('returns undefined when there are no export presets', () => {
    const node = mockExportNode([]);
    expect(getPreferredExportConstraint(node)).toBeUndefined();
  });

  it('uses only the first preset when several exist', () => {
    const node = mockExportNode([
      { format: 'PNG', constraint: { type: 'SCALE', value: 2 } },
      { format: 'PNG', constraint: { type: 'SCALE', value: 0.5 } },
    ]);
    expect(getPreferredExportConstraint(node)).toEqual({ type: 'SCALE', value: 2 });
  });

  it('reads constraint from the first JPG preset', () => {
    const node = mockExportNode([{ format: 'JPG', constraint: { type: 'WIDTH', value: 320 } }]);
    expect(getPreferredExportConstraint(node)).toEqual({ type: 'WIDTH', value: 320 });
  });

  it('returns undefined when the first preset is not raster (e.g. SVG)', () => {
    const node = mockExportNode([{ format: 'SVG' }, { format: 'PNG', constraint: { type: 'SCALE', value: 3 } }]);
    expect(getPreferredExportConstraint(node)).toBeUndefined();
  });

  it('returns undefined for image preset without constraint', () => {
    const node = mockExportNode([{ format: 'PNG' }]);
    expect(getPreferredExportConstraint(node)).toBeUndefined();
  });

  it('returns undefined for malformed first preset entry', () => {
    const node = mockExportNode([undefined as unknown as ExportSettings]);
    expect(getPreferredExportConstraint(node)).toBeUndefined();
  });
});

describe('tryExportPng', () => {
  it('reports and returns undefined when exportAsync is missing', async () => {
    const report = new ReportCollector();
    const node = { id: 'n1', type: 'SLICE' } as unknown as SceneNode;
    const bytes = await tryExportPng(node, report);
    expect(bytes).toBeUndefined();
    const entries = report.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('error');
    expect(entries[0].nodeId).toBe('n1');
    expect(entries[0].message).toMatch(/exportAsync/i);
  });

  it('reports and returns undefined when exportAsync rejects', async () => {
    const report = new ReportCollector();
    const node = {
      id: 'n2',
      exportSettings: [{ format: 'PNG', constraint: { type: 'SCALE', value: 1 } }],
      exportAsync: async () => {
        throw new Error('boom');
      },
    } as unknown as SceneNode;
    const bytes = await tryExportPng(node, report);
    expect(bytes).toBeUndefined();
    expect(report.getEntries()[0].message).toMatch(/boom/);
  });

  it('returns bytes when export succeeds', async () => {
    const report = new ReportCollector();
    const payload = new Uint8Array([137, 80, 78, 71]);
    const node = {
      id: 'n3',
      exportSettings: [{ format: 'PNG' }],
      exportAsync: async (opts: ExportSettings) => {
        expect(opts).toMatchObject({ format: 'PNG', constraint: { type: 'SCALE', value: 1 } });
        return payload;
      },
    } as unknown as SceneNode;
    const bytes = await tryExportPng(node, report);
    expect(bytes).toEqual(payload);
    expect(report.getEntries()).toHaveLength(0);
  });
});
