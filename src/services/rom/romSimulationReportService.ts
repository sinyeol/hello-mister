import type {
  RomSimulationExportOptions,
  RomSimulatedTransferRecord,
  RomSimulatedTransferReport,
  RomSimulatedTransferSession,
} from '../../types/rom';
import { sanitizeForExport, createFullPathWarning } from './exportSanitizer';

const browserSimulationRecordsKey = 'hello-mister-v2-rom-simulation-records';

export function createSimulationRecord(session: RomSimulatedTransferSession): RomSimulatedTransferRecord {
  const failedSteps = session.steps.filter((step) => step.status === 'failed').length;
  const completedSteps = session.steps.filter((step) => step.status === 'success').length;
  const record: RomSimulatedTransferRecord = {
    simulationRecordId: session.sessionId,
    schemaVersion: 1,
    appVersion: '2.1.1',
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    targetAlias: session.targetAlias,
    targetHost: session.targetHost,
    status: session.status,
    failureMode: session.failureMode,
    simulatedFileCount: session.progress.totalFiles,
    simulatedTotalBytes: session.progress.totalBytes,
    completedSteps,
    failedSteps,
    cancelled: session.status === 'cancelled',
    durationMs: Math.max(0, Date.parse(session.updatedAt) - Date.parse(session.createdAt)),
    message: session.message,
    remoteWritesPerformed: false,
    dryRun: true,
    readOnly: true,
    includesFullLocalPaths: false,
  };
  return sanitizeForExport(record);
}

export class RomSimulationReportService {
  async loadRecords(): Promise<RomSimulatedTransferRecord[]> {
    if (typeof window === 'undefined') return [];
    try {
      const parsed = JSON.parse(window.localStorage.getItem(browserSimulationRecordsKey) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async saveRecord(record: RomSimulatedTransferRecord): Promise<RomSimulatedTransferRecord[]> {
    const safe = sanitizeForExport({ ...record, includesFullLocalPaths: false as const });
    const records = await this.loadRecords();
    const next = [safe, ...records.filter((item) => item.simulationRecordId !== safe.simulationRecordId)].slice(0, 100);
    if (typeof window !== 'undefined') window.localStorage.setItem(browserSimulationRecordsKey, JSON.stringify(next));
    return next;
  }

  async deleteRecord(recordId: string): Promise<RomSimulatedTransferRecord[]> {
    const next = (await this.loadRecords()).filter((record) => record.simulationRecordId !== recordId);
    if (typeof window !== 'undefined') window.localStorage.setItem(browserSimulationRecordsKey, JSON.stringify(next));
    return next;
  }

  createReport(record: RomSimulatedTransferRecord, options: RomSimulationExportOptions): RomSimulatedTransferReport {
    const includeFullLocalPaths = Boolean(options.includeFullLocalPaths);
    return sanitizeForExport({
      schemaVersion: 1,
      appVersion: record.appVersion,
      generatedAt: new Date().toISOString(),
      reportType: 'rom-simulated-transfer',
      record,
      mandatoryNotice: [
        '이 리포트는 시뮬레이션 결과입니다.',
        '원격 MiSTer에는 어떤 파일도 쓰지 않았습니다.',
        '실제 ROM 복사가 아닙니다.',
        createFullPathWarning(includeFullLocalPaths),
      ],
      includesFullLocalPaths: includeFullLocalPaths,
    }, { includeFullLocalPaths });
  }

  toMarkdown(report: RomSimulatedTransferReport) {
    return [
      '# ROM 전송 시뮬레이션 리포트',
      '',
      ...report.mandatoryNotice.map((line) => `> ${line}`),
      '',
      `- 생성 시간: ${report.generatedAt}`,
      `- 상태: ${report.record.status}`,
      `- 실패 시나리오: ${report.record.failureMode}`,
      `- 파일 수: ${report.record.simulatedFileCount}`,
      `- 총 용량: ${report.record.simulatedTotalBytes}`,
      `- 완료 단계: ${report.record.completedSteps}`,
      `- 실패 단계: ${report.record.failedSteps}`,
      `- 취소됨: ${String(report.record.cancelled)}`,
      `- remoteWritesPerformed: ${String(report.record.remoteWritesPerformed)}`,
      '',
      report.record.message,
    ].join('\n');
  }

  export(report: RomSimulatedTransferReport, format: 'json' | 'markdown') {
    if (format === 'markdown') return this.toMarkdown(report);
    return JSON.stringify(report, null, 2);
  }
}
