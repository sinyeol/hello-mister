import type {
  RomDryRunResult,
  RomDryRunValidationChecklist,
  RomDryRunValidationRecord,
  RomDryRunValidationSession,
  RomPlanExportOptions,
} from '../../types/rom';
import { sanitizeForExport } from './exportSanitizer';
import { summarizeRomPlan } from './romPlanSummaryService';

const browserValidationRecordsKey = 'hello-mister-v2-rom-validation-records';

function stripSecrets<T>(value: T): T {
  return sanitizeForExport(value);
}

export const defaultValidationChecklist: RomDryRunValidationChecklist = {
  ranOnRealMister: false,
  hostKeyTrusted: false,
  gamesSnapshotRead: false,
  storageDryRunCalculated: false,
  reviewedAllConflicts: false,
  resolvedManualPlatforms: false,
  backupPlanForReplace: false,
  reviewedFolderCreationPlan: false,
  exportedPlanJson: false,
  confirmedNoRealCopy: true,
};

export function createValidationRecord(input: {
  session: RomDryRunValidationSession;
  dryRunResult?: RomDryRunResult;
  hostKeyTrustStatus: RomDryRunValidationRecord['hostKeyTrustStatus'];
  checklist?: Partial<RomDryRunValidationChecklist>;
  userNote?: string;
  options?: RomPlanExportOptions;
}): RomDryRunValidationRecord {
  const now = new Date().toISOString();
  const plan = input.dryRunResult?.plan;
  const summary = plan ? summarizeRomPlan(plan) : undefined;
  const checklist = { ...defaultValidationChecklist, ...input.checklist };
  const needsManualPlatformCount = plan?.sourceFiles.filter((file) => file.recommendation?.needsManualPlatform).length || 0;
  const record: RomDryRunValidationRecord = {
    validationSessionId: input.session.sessionId,
    schemaVersion: 1,
    appVersion: '2.1.0',
    createdAt: input.session.createdAt,
    updatedAt: now,
    targetProfileId: input.session.targetProfileId,
    targetAlias: input.session.targetAlias,
    targetHost: input.session.targetHost,
    hostKeyTrustStatus: input.hostKeyTrustStatus,
    romCandidateCount: plan?.sourceFiles.length || 0,
    totalSizeBytes: plan?.totalSizeBytes || 0,
    platformResolvedCount: plan ? plan.sourceFiles.length - needsManualPlatformCount : 0,
    needsManualPlatformCount,
    conflictCount: input.dryRunResult?.conflicts.filter((conflict) => conflict.conflictType !== 'none').length || 0,
    blockedCount: summary?.blockedCount || 0,
    targetFolderMissingCount: summary?.conflictCounts.targetFolderMissing || 0,
    storageStatus: input.dryRunResult?.storage.status || 'unknown',
    dryRunResultStatus: input.session.summary.status,
    durationMs: input.session.summary.durationMs,
    userNote: input.userNote,
    checklist,
    sanitizedSummary: input.session.summary.message,
    includesFullLocalPaths: false,
    dryRun: true,
    readOnly: true,
  };
  return stripSecrets(record);
}

export function maskValidationRecord(record: RomDryRunValidationRecord): RomDryRunValidationRecord {
  return stripSecrets({ ...record, includesFullLocalPaths: false });
}

export class RomValidationRecordService {
  async loadRecords(): Promise<RomDryRunValidationRecord[]> {
    if (typeof window === 'undefined') return [];
    try {
      const parsed = JSON.parse(window.localStorage.getItem(browserValidationRecordsKey) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async saveRecord(record: RomDryRunValidationRecord): Promise<RomDryRunValidationRecord[]> {
    const safe = maskValidationRecord(record);
    const records = await this.loadRecords();
    const next = [safe, ...records.filter((item) => item.validationSessionId !== safe.validationSessionId)].slice(0, 100);
    if (typeof window !== 'undefined') window.localStorage.setItem(browserValidationRecordsKey, JSON.stringify(next));
    return next;
  }

  async deleteRecord(recordId: string): Promise<RomDryRunValidationRecord[]> {
    const next = (await this.loadRecords()).filter((record) => record.validationSessionId !== recordId);
    if (typeof window !== 'undefined') window.localStorage.setItem(browserValidationRecordsKey, JSON.stringify(next));
    return next;
  }

  async updateRecord(recordId: string, patch: Partial<Pick<RomDryRunValidationRecord, 'checklist' | 'userNote'>>): Promise<RomDryRunValidationRecord[]> {
    const records = await this.loadRecords();
    const now = new Date().toISOString();
    const next = records.map((record) => (
      record.validationSessionId === recordId
        ? maskValidationRecord({ ...record, ...patch, updatedAt: now })
        : record
    ));
    if (typeof window !== 'undefined') window.localStorage.setItem(browserValidationRecordsKey, JSON.stringify(next));
    return next;
  }
}
