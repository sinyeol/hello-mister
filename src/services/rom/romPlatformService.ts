import type { LocalRomCandidate, LocalRomMetadata, RomPlatformCandidate, RomPlatformGuess, RomTargetFolder, RomTargetRecommendation } from '../../types/rom';

export const romPlatformCandidates: RomPlatformCandidate[] = [
  { platform: 'NES', label: 'NES / Famicom', extensions: ['.nes'], coreFolderNames: ['NES'] },
  { platform: 'FDS', label: 'Famicom Disk System', extensions: ['.fds'], coreFolderNames: ['NES', 'FDS'], ambiguous: true },
  { platform: 'SNES', label: 'SNES / Super Famicom', extensions: ['.sfc', '.smc', '.bs'], coreFolderNames: ['SNES', 'SFC'] },
  { platform: 'Genesis', label: 'Genesis / MegaDrive', extensions: ['.md', '.gen', '.smd'], coreFolderNames: ['Genesis', 'MegaDrive', 'Mega Drive'] },
  { platform: 'SMS', label: 'Master System', extensions: ['.sms'], coreFolderNames: ['SMS', 'MasterSystem'] },
  { platform: 'GameGear', label: 'Game Gear', extensions: ['.gg'], coreFolderNames: ['GameGear', 'Game Gear'] },
  { platform: 'Gameboy', label: 'Game Boy', extensions: ['.gb'], coreFolderNames: ['Gameboy', 'Game Boy', 'GB'] },
  { platform: 'GBC', label: 'Game Boy Color', extensions: ['.gbc'], coreFolderNames: ['GBC', 'GameboyColor', 'Game Boy Color'] },
  { platform: 'GBA', label: 'Game Boy Advance', extensions: ['.gba'], coreFolderNames: ['GBA', 'GameboyAdvance', 'Game Boy Advance'] },
  { platform: 'PCEngine', label: 'PC Engine / TGFX16', extensions: ['.pce'], coreFolderNames: ['TGFX16', 'PCEngine', 'PC Engine'], ambiguous: true },
  { platform: 'NeoGeoPocket', label: 'Neo Geo Pocket', extensions: ['.ngp', '.ngc'], coreFolderNames: ['NeoGeoPocket', 'NGP'] },
  { platform: 'Atari2600', label: 'Atari 2600', extensions: ['.a26'], coreFolderNames: ['Atari2600', 'Atari 2600'] },
  { platform: 'Atari5200', label: 'Atari 5200', extensions: ['.a52'], coreFolderNames: ['Atari5200', 'Atari 5200'] },
  { platform: 'Atari7800', label: 'Atari 7800', extensions: ['.a78'], coreFolderNames: ['Atari7800', 'Atari 7800'] },
  { platform: 'Lynx', label: 'Atari Lynx', extensions: ['.lnx'], coreFolderNames: ['Lynx', 'AtariLynx'] },
  { platform: 'Coleco', label: 'ColecoVision', extensions: ['.col'], coreFolderNames: ['Coleco', 'ColecoVision'] },
  { platform: 'MSX', label: 'MSX', extensions: ['.mx1', '.mx2', '.rom'], coreFolderNames: ['MSX', 'MSX1', 'MSX2'], ambiguous: true },
  { platform: 'ZXSpectrum', label: 'ZX Spectrum', extensions: ['.z80', '.tap', '.tzx'], coreFolderNames: ['ZXSpectrum', 'ZX Spectrum', 'Spectrum'] },
  { platform: 'C64', label: 'Commodore 64', extensions: ['.d64', '.g64', '.t64', '.prg'], coreFolderNames: ['C64', 'Commodore64', 'Commodore 64'] },
  { platform: 'Amiga', label: 'Amiga', extensions: ['.adf', '.hdf'], coreFolderNames: ['Amiga'], ambiguous: true },
  { platform: 'AtariST', label: 'Atari ST', extensions: ['.st', '.msa'], coreFolderNames: ['AtariST', 'Atari ST'] },
  { platform: 'X68000', label: 'X68000 / PC-98', extensions: ['.xdf', '.dim', '.hdi'], coreFolderNames: ['X68000', 'PC98', 'PC-98'], ambiguous: true },
  { platform: 'DiskImage', label: 'Disk image candidates', extensions: ['.dsk'], coreFolderNames: ['Amstrad', 'MSX', 'CPC'], ambiguous: true },
  { platform: 'Arcade', label: 'Arcade / MAME', extensions: ['.zip'], coreFolderNames: ['Arcade', 'MAME', 'NeoGeo'], ambiguous: true },
  { platform: 'Archive', label: 'Compressed ROM archive', extensions: ['.7z'], coreFolderNames: ['Arcade', 'MAME', 'NeoGeo'], ambiguous: true },
  { platform: 'CD', label: 'CD 기반 코어', extensions: ['.chd', '.cue', '.bin', '.iso'], coreFolderNames: ['MegaCD', 'SegaCD', 'PSX', 'TGFX16-CD'], ambiguous: true },
  { platform: 'ao486', label: 'ao486 / VHD', extensions: ['.vhd'], coreFolderNames: ['ao486'], ambiguous: true },
];

const ambiguousExtensions = new Set(['.zip', '.cue', '.bin', '.chd', '.iso', '.vhd', '.7z', '.fds', '.pce', '.dsk', '.mx1', '.mx2', '.rom', '.adf', '.hdf', '.xdf', '.dim', '.hdi']);

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function normalizeGameName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '').replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export class RomPlatformRecommendationService {
  createCandidate(metadata: LocalRomMetadata, remoteFolders: RomTargetFolder[], manualPlatform?: string): LocalRomCandidate {
    const platformGuesses = this.guessPlatforms(metadata);
    const recommendation = this.recommendTarget(metadata, remoteFolders, platformGuesses, manualPlatform);
    return {
      ...metadata,
      normalizedGameName: normalizeGameName(metadata.fileName),
      possibleCardTitle: normalizeGameName(metadata.fileName),
      possibleNfcLaunchPath: recommendation.targetRemotePath,
      misterLaunchPathCandidate: recommendation.targetRemotePath,
      platformGuesses,
      manualPlatform,
      recommendation,
      status: recommendation.needsManualPlatform
        ? 'needs-platform'
        : !recommendation.targetFolderExists
          ? 'target-missing'
          : recommendation.platform
            ? 'ready'
            : 'unsupported',
    };
  }

  guessPlatforms(metadata: LocalRomMetadata): RomPlatformGuess[] {
    const ext = metadata.extension.toLowerCase();
    const folderName = metadata.parentFolder.split(/[\\/]/).pop() || '';
    const folderKey = normalizeName(folderName);
    const fileKey = normalizeName(metadata.fileName);
    const extensionMatches = romPlatformCandidates.filter((candidate) => candidate.extensions.includes(ext));
    const keywordMatches = romPlatformCandidates.filter((candidate) => (
      candidate.coreFolderNames.some((folder) => {
        const key = normalizeName(folder);
        return key.length > 2 && (folderKey.includes(key) || fileKey.includes(key));
      })
    ));
    const merged = [...extensionMatches, ...keywordMatches].filter((candidate, index, array) => (
      array.findIndex((item) => item.platform === candidate.platform) === index
    ));
    return merged.map((candidate) => {
      const ambiguous = candidate.ambiguous || ambiguousExtensions.has(ext);
      return {
        platform: candidate.platform,
        coreFolderNames: candidate.coreFolderNames,
        confidence: ambiguous ? 'needs-user' : extensionMatches.some((item) => item.platform === candidate.platform) ? 'high' : 'medium',
        reason: ambiguous ? `${ext} 확장자는 여러 코어에서 쓰일 수 있어 수동 선택이 필요합니다.` : `${ext} 확장자와 폴더/파일명 기준 추천입니다.`,
        autoSelectable: !ambiguous,
      };
    });
  }

  recommendTarget(metadata: LocalRomMetadata, remoteFolders: RomTargetFolder[], guesses: RomPlatformGuess[], manualPlatform?: string): RomTargetRecommendation {
    const selected = manualPlatform
      ? romPlatformCandidates.find((candidate) => candidate.platform === manualPlatform)
      : romPlatformCandidates.find((candidate) => guesses.find((guess) => guess.platform === candidate.platform && guess.autoSelectable));
    if (!selected) {
      return {
        confidence: 'needs-user',
        reason: guesses.length ? '여러 플랫폼 후보가 있어 사용자가 직접 선택해야 합니다.' : '지원 확장자 또는 플랫폼 힌트를 찾지 못했습니다.',
        targetFolderExists: false,
        needsManualPlatform: true,
      };
    }
    const matchedFolder = this.findRemoteFolder(selected.coreFolderNames, remoteFolders);
    const targetFolder = matchedFolder?.remotePath || `/media/fat/games/${selected.coreFolderNames[0]}`;
    return {
      platform: selected.platform,
      targetFolder,
      targetRemotePath: `${targetFolder}/${metadata.fileName}`,
      confidence: manualPlatform ? 'high' : matchedFolder ? 'high' : 'medium',
      reason: manualPlatform ? '사용자가 선택한 플랫폼을 우선 적용했습니다.' : matchedFolder ? '원격 games 폴더와 추천 플랫폼이 일치합니다.' : '추천 플랫폼은 찾았지만 원격 대상 폴더가 없습니다.',
      targetFolderExists: Boolean(matchedFolder),
      needsManualPlatform: false,
    };
  }

  private findRemoteFolder(names: string[], remoteFolders: RomTargetFolder[]) {
    const normalizedNames = names.map(normalizeName);
    return remoteFolders.find((folder) => normalizedNames.includes(normalizeName(folder.coreName)));
  }
}
