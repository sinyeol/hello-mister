export type TaskRiskLevel = string;
export type TaskStatus = string;
export type TaskCategory = 'network' | 'sd' | 'ini' | 'script' | 'backup' | 'diagnostics' | 'dry-run';

export interface SafeTaskLog {
  at: string;
  message: string;
}

export interface SafeTask<TPreview = unknown> {
  id: string;
  title: string;
  description: string;
  category?: TaskCategory;
  riskLevel: TaskRiskLevel;
  dryRun: boolean;
  readOnly?: boolean;
  status: TaskStatus;
  preview?: TPreview;
  logs: SafeTaskLog[];
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  targetProfileId?: string;
  targetAlias?: string;
  targetHost?: string;
  resultSummary?: string;
  errorCode?: string;
  sanitizedErrorMessage?: string;
}

export interface SafeActionResult {
  ok: boolean;
  dryRun: boolean;
  message: string;
  logs: string[];
  error?: {
    code: string;
    message: string;
  };
}
