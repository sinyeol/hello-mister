import type {
  RomDryRunValidationComparison,
  RomDryRunValidationFilter,
  RomDryRunValidationGrade,
  RomDryRunValidationRecord,
  RomDryRunValidationSort,
} from '../../types/rom';

export function calculateValidationGrade(record: RomDryRunValidationRecord): RomDryRunValidationGrade {
  if (record.hostKeyTrustStatus === 'mismatch') return 'not-eligible-for-transfer';
  if (record.storageStatus === 'insufficient' || record.storageStatus === 'unknown') return 'needs-recheck';
  if (record.blockedCount > 0) return 'blocked';
  if (record.needsManualPlatformCount > 0 || record.conflictCount > 0 || record.dryRunResultStatus === 'partial-success') return 'partial';
  if (record.dryRunResultStatus === 'success' && record.checklist.confirmedNoRealCopy) return 'passed';
  return 'needs-recheck';
}

export function compareValidationRecords(base: RomDryRunValidationRecord, current: RomDryRunValidationRecord): RomDryRunValidationComparison {
  const comparison: RomDryRunValidationComparison = {
    baseRecordId: base.validationSessionId,
    currentRecordId: current.validationSessionId,
    romCandidateDelta: current.romCandidateCount - base.romCandidateCount,
    conflictDelta: current.conflictCount - base.conflictCount,
    blockedDelta: current.blockedCount - base.blockedCount,
    totalSizeDeltaBytes: current.totalSizeBytes - base.totalSizeBytes,
    storageStatusChanged: current.storageStatus !== base.storageStatus,
    targetProfileChanged: current.targetProfileId !== base.targetProfileId || current.targetHost !== base.targetHost,
    summary: '',
  };
  comparison.summary = `ROM 후보 ${comparison.romCandidateDelta >= 0 ? '+' : ''}${comparison.romCandidateDelta}, 충돌 ${comparison.conflictDelta >= 0 ? '+' : ''}${comparison.conflictDelta}, 차단 ${comparison.blockedDelta >= 0 ? '+' : ''}${comparison.blockedDelta}`;
  return comparison;
}

export function filterValidationRecords(records: RomDryRunValidationRecord[], filter: RomDryRunValidationFilter) {
  return records.filter((record) => {
    const grade = calculateValidationGrade(record);
    if (filter === 'all') return true;
    if (filter === 'passed') return grade === 'passed';
    if (filter === 'partial') return grade === 'partial';
    if (filter === 'blocked') return grade === 'blocked' || grade === 'not-eligible-for-transfer';
    if (filter === 'hostKeyIssue') return record.hostKeyTrustStatus === 'mismatch' || record.hostKeyTrustStatus === 'untrusted';
    if (filter === 'storageIssue') return record.storageStatus !== 'sufficient';
    if (filter === 'needsManualPlatform') return record.needsManualPlatformCount > 0;
    if (filter === 'hasConflict') return record.conflictCount > 0;
    return true;
  });
}

export function sortValidationRecords(records: RomDryRunValidationRecord[], sort: RomDryRunValidationSort) {
  return [...records].sort((left, right) => {
    if (sort === 'date-asc') return left.createdAt.localeCompare(right.createdAt);
    if (sort === 'file-count') return right.romCandidateCount - left.romCandidateCount;
    if (sort === 'total-size') return right.totalSizeBytes - left.totalSizeBytes;
    if (sort === 'conflict-count') return right.conflictCount - left.conflictCount;
    if (sort === 'blocked-count') return right.blockedCount - left.blockedCount;
    return right.createdAt.localeCompare(left.createdAt);
  });
}

export function formatValidationGrade(grade: RomDryRunValidationGrade) {
  const labels: Record<RomDryRunValidationGrade, string> = {
    passed: '통과',
    partial: '부분 통과',
    blocked: '차단됨',
    'needs-recheck': '재검증 필요',
    'not-eligible-for-transfer': '실제 전송 검토 불가',
  };
  return labels[grade];
}
