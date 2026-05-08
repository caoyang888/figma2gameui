export type OutputFile = {
  path: string;
  data: Uint8Array;
};

export type ReportLevel = 'error' | 'warning' | 'info';

export type ReportEntry = {
  level: ReportLevel;
  message: string;
  nodeId?: string;
};
