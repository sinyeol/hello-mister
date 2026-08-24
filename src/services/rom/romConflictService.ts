import type { LocalRomCandidate, RemoteGameFolderSnapshot, RomConflictCheckResult } from '../../types/rom';

const supportedExtensions = new Set([
  '.zip',
  '.7z',
  '.nes',
  '.fds',
  '.sfc',
  '.smc',
  '.bs',
  '.md',
  '.gen',
  '.smd',
  '.sms',
  '.gg',
  '.gb',
  '.gbc',
  '.gba',
  '.pce',
  '.ngp',
  '.ngc',
  '.chd',
  '.cue',
  '.bin',
  '.iso',
  '.vhd',
  '.a26',
  '.a52',
  '.a78',
  '.lnx',
  '.col',
  '.dsk',
  '.mx1',
  '.mx2',
  '.rom',
  '.z80',
  '.tap',
  '.tzx',
  '.d64',
  '.g64',
  '.t64',
  '.prg',
  '.adf',
  '.hdf',
  '.st',
  '.msa',
  '.xdf',
  '.dim',
  '.hdi',
]);

export class RomConflictService {
  inspect(candidate: LocalRomCandidate, snapshot?: RemoteGameFolderSnapshot): RomConflictCheckResult {
    if (!supportedExtensions.has(candidate.extension.toLowerCase())) {
      return {
        candidateId: candidate.id,
        conflictType: 'unsupportedExtension',
        severity: 'warning',
        message: '지원 목록에 없는 확장자입니다. 실제 복사 전 사용자가 확인해야 합니다.',
      };
    }
    if (candidate.recommendation?.needsManualPlatform) {
      return {
        candidateId: candidate.id,
        conflictType: 'needsManualPlatform',
        severity: 'warning',
        message: '플랫폼을 수동으로 선택해야 합니다.',
      };
    }
    if (!candidate.recommendation?.targetFolderExists) {
      return {
        candidateId: candidate.id,
        conflictType: 'targetFolderMissing',
        severity: 'blocker',
        message: '원격 대상 폴더가 없습니다. 이번 단계에서는 폴더 생성을 지원하지 않습니다.',
      };
    }
    if (!snapshot?.ok) {
      return {
        candidateId: candidate.id,
        conflictType: 'remoteReadFailed',
        severity: 'warning',
        message: snapshot?.message || '원격 대상 폴더 파일 목록을 읽지 못했습니다.',
      };
    }
    const existing = snapshot.files.find((file) => file.name.toLowerCase() === candidate.fileName.toLowerCase());
    if (!existing) {
      return {
        candidateId: candidate.id,
        conflictType: 'none',
        severity: 'info',
        message: '같은 이름의 원격 파일이 없습니다.',
      };
    }
    if (typeof existing.sizeBytes === 'number' && existing.sizeBytes === candidate.sizeBytes) {
      return {
        candidateId: candidate.id,
        conflictType: 'sameNameSameSize',
        severity: 'warning',
        message: '같은 이름과 같은 크기의 파일이 이미 있습니다. 동일 파일일 가능성이 높습니다.',
        remoteFile: existing,
      };
    }
    return {
      candidateId: candidate.id,
      conflictType: 'sameNameDifferentSize',
      severity: 'blocker',
      message: '같은 이름이지만 크기가 다른 파일이 이미 있습니다. 덮어쓰기는 지원하지 않습니다.',
      remoteFile: existing,
    };
  }
}
