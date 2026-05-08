import { describe, it, expect } from 'vitest';
import { ReportCollector } from '../src/pipeline/report';

describe('ReportCollector', () => {
  it('sortForDisplay puts errors first and preserves stable order within level', () => {
    const b = new ReportCollector();
    b.add('info', 'i1');
    b.add('error', 'e1');
    b.add('info', 'i2');
    b.add('error', 'e2');
    const sorted = b.sortForDisplay();
    expect(sorted.map((r) => r.level)).toEqual(['error', 'error', 'info', 'info']);
    expect(sorted.map((r) => r.message)).toEqual(['e1', 'e2', 'i1', 'i2']);
  });
});
