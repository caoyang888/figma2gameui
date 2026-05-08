import type { ReportEntry, ReportLevel } from '../shared/types';

export class ReportCollector {
  private readonly entries: ReportEntry[] = [];

  add(level: ReportLevel, message: string, nodeId?: string): void {
    const entry: ReportEntry = { level, message };
    if (nodeId !== undefined) {
      entry.nodeId = nodeId;
    }
    this.entries.push(entry);
  }

  getEntries(): readonly ReportEntry[] {
    return this.entries;
  }

  hasErrors(): boolean {
    return this.entries.some((e) => e.level === 'error');
  }

  sortForDisplay(): ReportEntry[] {
    return ReportCollector.sortEntries(this.entries);
  }

  static sortEntries(entries: readonly ReportEntry[]): ReportEntry[] {
    const rank = (l: ReportLevel): number => {
      if (l === 'error') return 0;
      if (l === 'warning') return 1;
      return 2;
    };
    return [...entries]
      .map((e, i) => ({ e, i }))
      .sort((a, b) => {
        const dr = rank(a.e.level) - rank(b.e.level);
        return dr !== 0 ? dr : a.i - b.i;
      })
      .map(({ e }) => e);
  }
}
