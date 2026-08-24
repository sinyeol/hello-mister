import type { IniApplyPlan, IniExportResult, IniPreset, IniProfile } from '../../types/ini';

export interface IniProfileService {
  listProfiles(): Promise<IniProfile[]>;
  createApplyPlan(preset: IniPreset, mode: IniApplyPlan['mode'], rebootAfterApply: boolean): IniApplyPlan;
  renderPresetFile(preset: IniPreset): string;
  exportPresetFile(preset: IniPreset): Promise<IniExportResult>;
}

export class DryRunIniProfileService implements IniProfileService {
  async listProfiles(): Promise<IniProfile[]> {
    return [
      { id: 'main', fileName: 'MiSTer.ini', displayName: '현재 기본 INI', source: '기본' },
      { id: 'alt-1', fileName: 'MiSTer_alt_1.ini', displayName: '대체 INI 1', source: '대체' },
      { id: 'custom-hdmi', fileName: 'MiSTer_HDMI.ini', displayName: 'HDMI 기본 후보', source: '커스텀' },
    ];
  }

  createApplyPlan(preset: IniPreset, mode: IniApplyPlan['mode'], rebootAfterApply: boolean): IniApplyPlan {
    const timestamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    return {
      presetId: preset.id,
      mode,
      targetPath: mode === '현재 MiSTer.ini로 적용' ? '/media/fat/MiSTer.ini' : `/media/fat/${preset.fileNameCandidate}`,
      backupPath: `/media/fat/backups/ini/MiSTer.ini.${timestamp}.bak`,
      dryRun: true,
      rebootAfterApply,
    };
  }

  renderPresetFile(preset: IniPreset): string {
    const lines = [
      `; Hello Mister v2.1 INI 프리셋: ${preset.name}`,
      `; 파일명 후보: ${preset.fileNameCandidate}`,
      `; 목적: ${preset.purpose}`,
      `; 주의: 아직 공식 MiSTer.ini 템플릿과 장치 현재값 기반 병합이 필요합니다.`,
      '',
    ];
    for (const value of preset.values) {
      lines.push(`; ${value.label}: ${value.description}`);
      lines.push(`${value.key}=${value.value}`);
      lines.push('');
    }
    return lines.join('\n');
  }

  async exportPresetFile(preset: IniPreset): Promise<IniExportResult> {
    const content = this.renderPresetFile(preset);
    if (window.helloMisterDesktop?.saveTextFile) {
      return window.helloMisterDesktop.saveTextFile({
        defaultPath: preset.fileNameCandidate,
        content,
        filters: [{ name: 'MiSTer INI', extensions: ['ini'] }],
      });
    }

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = preset.fileNameCandidate;
    anchor.click();
    URL.revokeObjectURL(url);
    return { ok: true, message: '브라우저 다운로드 방식으로 INI 프리셋을 내보냈습니다.' };
  }
}
