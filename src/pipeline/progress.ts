export type ProgressCallback = (label: string, ratio: number) => void;

export class ProgressReporter {
  constructor(private readonly callback: ProgressCallback) {}

  report(label: string, ratio: number): void {
    this.callback(label, Math.max(0, Math.min(1, ratio)));
  }

  static noop(): ProgressReporter {
    return new ProgressReporter(() => {});
  }
}
