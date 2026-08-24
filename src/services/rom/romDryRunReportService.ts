import type {
  RomBackupPlan,
  RomDryRunReport,
  RomDryRunReportExportOptions,
  RomDryRunValidationRecord,
  RomTransferPreflightResult,
} from '../../types/rom';
import { romTransferSafetyPolicy } from './romTransferSafetyPolicy';
import { calculateValidationGrade, formatValidationGrade } from './romValidationRecordAnalysisService';
import { sanitizeForExport, createFullPathWarning } from './exportSanitizer';

export class RomDryRunReportService {
  createReport(input: {
    record: RomDryRunValidationRecord;
    backupPlan?: RomBackupPlan;
    preflight?: RomTransferPreflightResult;
    options?: RomDryRunReportExportOptions;
  }): RomDryRunReport {
    const includeFullLocalPaths = Boolean(input.options?.includeFullLocalPaths);
    const report: RomDryRunReport = {
      schemaVersion: 1,
      appVersion: input.record.appVersion || '2.1.0',
      generatedAt: new Date().toISOString(),
      reportType: 'rom-dry-run-validation',
      target: {
        alias: input.record.targetAlias,
        host: input.record.targetHost,
        profileId: input.record.targetProfileId,
        hostKeyTrustStatus: input.record.hostKeyTrustStatus,
      },
      validation: {
        recordId: input.record.validationSessionId,
        grade: calculateValidationGrade(input.record),
        romCandidateCount: input.record.romCandidateCount,
        totalSizeBytes: input.record.totalSizeBytes,
        platformResolvedCount: input.record.platformResolvedCount,
        needsManualPlatformCount: input.record.needsManualPlatformCount,
        conflictCount: input.record.conflictCount,
        blockedCount: input.record.blockedCount,
        targetFolderMissingCount: input.record.targetFolderMissingCount,
        storageStatus: input.record.storageStatus,
        checklist: input.record.checklist,
      },
      backupSummary: input.backupPlan ? {
        requiredFileCount: input.backupPlan.items.length,
        totalSizeBytes: input.backupPlan.totalSizeBytes,
        backupRootLocalPath: input.backupPlan.backupRootLocalPath,
      } : undefined,
      preflight: input.preflight,
      rollbackLimitations: romTransferSafetyPolicy.rollbackLimitations,
      lockedReason: '실제 ROM 전송은 feature flag와 kill switch, write IPC 미노출 정책 때문에 계속 잠겨 있습니다.',
      warning: createFullPathWarning(includeFullLocalPaths),
      includesFullLocalPaths: includeFullLocalPaths,
    };
    return sanitizeForExport(report, { includeFullLocalPaths });
  }

  toMarkdown(report: RomDryRunReport) {
    const blockers = report.preflight?.blockers.map((blocker) => `- ${blocker.code}: ${blocker.message}`).join('\n') || '- preflight 미실행';
    const checklist = Object.entries(report.validation.checklist)
      .map(([key, value]) => `- ${value ? '[x]' : '[ ]'} ${key}`)
      .join('\n');
    return [
      '# ROM dry-run 검증 리포트',
      '',
      `- 생성 시간: ${report.generatedAt}`,
      `- 앱 버전: ${report.appVersion}`,
      `- 대상: ${report.target.alias || report.target.host || '미정'}`,
      `- host key: ${report.target.hostKeyTrustStatus}`,
      `- 등급: ${formatValidationGrade(report.validation.grade)}`,
      `- ROM 후보: ${report.validation.romCandidateCount}`,
      `- 총 용량: ${report.validation.totalSizeBytes}`,
      `- 플랫폼 수동 선택 필요: ${report.validation.needsManualPlatformCount}`,
      `- 충돌: ${report.validation.conflictCount}`,
      `- 차단: ${report.validation.blockedCount}`,
      `- 저장공간 상태: ${report.validation.storageStatus}`,
      '',
      '## Preflight',
      `- canSimulate: ${String(report.preflight?.canSimulate ?? false)}`,
      `- canPrepare: ${String(report.preflight?.canPrepare ?? false)}`,
      '- canExecute: false',
      blockers,
      '',
      '## 사용자 확인 체크리스트',
      checklist,
      '',
      '## Rollback 한계',
      ...report.rollbackLimitations.map((item) => `- ${item.code}: ${item.message}`),
      '',
      `> ${report.lockedReason}`,
      `> ${report.warning}`,
    ].join('\n');
  }

  export(report: RomDryRunReport, format: 'json' | 'markdown') {
    if (format === 'markdown') return this.toMarkdown(report);
    return JSON.stringify(report, null, 2);
  }
}
