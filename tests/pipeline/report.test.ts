import { describe, it, expect } from 'vitest';
import { ReportCollector } from '../../src/pipeline/report';

describe('ReportCollector', () => {
  it('adds and retrieves entries', () => {
    const r = new ReportCollector();
    r.add('info', 'hello');
    r.add('error', 'boom');
    expect(r.getEntries()).toHaveLength(2);
  });

  it('hasErrors returns true when errors present', () => {
    const r = new ReportCollector();
    r.add('info', 'ok');
    expect(r.hasErrors()).toBe(false);
    r.add('error', 'fail');
    expect(r.hasErrors()).toBe(true);
  });

  it('sortForDisplay: error > warning > info, stable within level', () => {
    const r = new ReportCollector();
    r.add('info', 'i1');
    r.add('warning', 'w1');
    r.add('error', 'e1');
    r.add('info', 'i2');
    r.add('error', 'e2');
    const sorted = r.sortForDisplay();
    expect(sorted.map((e) => e.message)).toEqual(['e1', 'e2', 'w1', 'i1', 'i2']);
  });

  it('nodeId is optional', () => {
    const r = new ReportCollector();
    r.add('info', 'msg', 'node-1');
    expect(r.getEntries()[0].nodeId).toBe('node-1');
  });
});
