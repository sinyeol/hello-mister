import type { SdCardDrive, SdStructureCheckResult } from '../../types/sd';

export interface SdCardDetectionService {
  listRemovableDrives(): Promise<SdCardDrive[]>;
  inspectStructure(drive: SdCardDrive): Promise<SdStructureCheckResult>;
}

export class MockSdCardDetectionService implements SdCardDetectionService {
  async listRemovableDrives(): Promise<SdCardDrive[]> {
    return [
      {
        id: 'mock-sd-e',
        label: 'MRFUSION 후보 SD',
        mountPoint: 'E:\\',
        sizeGb: 32,
        freeGb: 18,
        fileSystem: 'FAT32',
        removable: true,
        systemDisk: false,
        selectable: true,
        selectionReason: 'mock: removable이며 시스템 디스크가 아닙니다.',
        diskNumber: 3,
        busType: 'USB',
        healthStatus: 'Healthy',
      },
      {
        id: 'blocked-system-c',
        label: '시스템 디스크 예시',
        mountPoint: 'C:\\',
        sizeGb: 1000,
        freeGb: 240,
        fileSystem: 'NTFS',
        removable: false,
        systemDisk: true,
        selectable: false,
        selectionReason: '시스템 디스크는 선택할 수 없습니다.',
        diskNumber: 0,
        busType: 'NVMe',
        healthStatus: 'Healthy',
      },
    ];
  }

  async inspectStructure(drive: SdCardDrive): Promise<SdStructureCheckResult> {
    return {
      driveId: drive.id,
      mountPoint: drive.mountPoint,
      checkedAt: new Date().toISOString(),
      ok: false,
      message: 'mock 구조 검사: 실제 파일 시스템을 읽지 않았습니다.',
      items: [
        { key: 'MiSTer.ini', label: 'MiSTer.ini', path: `${drive.mountPoint}MiSTer.ini`, exists: false, type: 'file' },
        { key: 'games', label: 'games', path: `${drive.mountPoint}games`, exists: true, type: 'folder' },
        { key: 'Scripts', label: 'Scripts', path: `${drive.mountPoint}Scripts`, exists: true, type: 'folder' },
        { key: 'config', label: 'config', path: `${drive.mountPoint}config`, exists: false, type: 'folder' },
        { key: 'linux', label: 'linux', path: `${drive.mountPoint}linux`, exists: false, type: 'folder' },
      ],
    };
  }
}

export class DesktopSdCardDetectionService implements SdCardDetectionService {
  private fallback = new MockSdCardDetectionService();

  async listRemovableDrives(): Promise<SdCardDrive[]> {
    if (window.helloMisterDesktop?.listWindowsDrives) {
      const drives = await window.helloMisterDesktop.listWindowsDrives();
      return drives.length ? drives : this.fallback.listRemovableDrives();
    }
    return this.fallback.listRemovableDrives();
  }

  async inspectStructure(drive: SdCardDrive): Promise<SdStructureCheckResult> {
    if (window.helloMisterDesktop?.inspectSdStructure) {
      return window.helloMisterDesktop.inspectSdStructure(drive.mountPoint, drive.id);
    }
    return this.fallback.inspectStructure(drive);
  }
}

export function isDriveSelectableForMrFusion(drive: SdCardDrive) {
  if (drive.systemDisk) return false;
  if (!drive.removable && !/usb|sd|mmc/i.test(drive.busType || '')) return false;
  if (drive.sizeGb <= 0 || drive.sizeGb > 1024) return false;
  return true;
}

export function formatDriveCapacity(drive: Pick<SdCardDrive, 'sizeGb' | 'freeGb'>) {
  return `${drive.sizeGb || 0}GB${typeof drive.freeGb === 'number' ? ` · 여유 ${drive.freeGb}GB` : ''}`;
}

export function formatSdStructureSummary(result: SdStructureCheckResult) {
  const found = result.items.filter((item) => item.exists).length;
  return `${found}/${result.items.length}개 항목 확인 · ${result.ok ? 'MiSTer SD 구조 가능성 있음' : '필수 항목 부족'}`;
}
