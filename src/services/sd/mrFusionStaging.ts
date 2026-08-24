import type { MrFusionStagedFile } from '../../types/sd';

export interface MrFusionStagingService {
  listStagedFiles(): Promise<MrFusionStagedFile[]>;
}

export class DryRunMrFusionStagingService implements MrFusionStagingService {
  async listStagedFiles(): Promise<MrFusionStagedFile[]> {
    return [
      { id: 'wifi', label: 'wpa_supplicant.conf', targetPath: 'MRFUSION:/wpa_supplicant.conf', status: '대기' },
      { id: 'samba', label: 'samba.sh', targetPath: 'MRFUSION:/samba.sh', status: '대기' },
      { id: 'scripts', label: '사용자 Scripts', targetPath: 'MRFUSION:/Scripts', status: 'dry-run' },
    ];
  }
}
