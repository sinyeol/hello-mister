import type {
  RomTransferReadinessChecklist,
  RomTransferReadinessItem,
  RomTransferReadinessStatus,
} from '../../types/rom';
import { sanitizeForExport } from './exportSanitizer';

const browserReadinessKey = 'hello-mister-v2-rom-transfer-readiness';

const baseItems: Array<Omit<RomTransferReadinessItem, 'status'>> = [
  { id: 'three-real-device-dry-runs', label: '실제 MiSTer에서 dry-run 검증 기록 3회 이상', required: true },
  { id: 'large-rom-set-dry-run', label: '대량 ROM 세트 dry-run 1회 이상', required: true },
  { id: 'host-key-trusted', label: 'host key trusted 상태 확인', required: true },
  { id: 'session-only-policy', label: 'session-only credential 정책 유지 확인', required: true },
  { id: 'backup-plan-created', label: 'backup plan 생성 확인', required: true },
  { id: 'replace-later-reviewed', label: 'replaceLater 항목 처리 확인', required: true },
  { id: 'target-folder-missing-reviewed', label: 'targetFolderMissing 항목 처리 확인', required: true },
  { id: 'storage-dry-run-passed', label: 'storage dry-run 통과', required: true },
  { id: 'dangerous-extension-reviewed', label: 'dangerous extension 수동 처리 완료', required: true },
  { id: 'final-confirmation-reviewed', label: 'final confirmation UX 확인', required: true },
  { id: 'simulation-scenarios-reviewed', label: 'simulated transfer 성공/취소/실패 시나리오 확인', required: true },
  { id: 'rollback-copy-reviewed', label: 'rollback 한계 문구 확인', required: true },
  { id: 'write-ipc-absent', label: 'write IPC가 아직 노출되지 않았는지 확인', required: true },
  { id: 'raw-command-absent', label: 'raw command IPC가 없는지 확인', required: true },
  { id: 'all-tests-passed', label: '테스트 전체 통과', required: true },
];

export function createDefaultReadinessChecklist(): RomTransferReadinessChecklist {
  return {
    schemaVersion: 1,
    appVersion: '2.1.0',
    updatedAt: new Date().toISOString(),
    items: baseItems.map((item) => ({ ...item, status: 'unchecked' })),
    canConsiderRealTransfer: false,
    lockedMessage: '실제 전송은 아직 잠겨 있습니다. 이 체크리스트는 검토용이며 전송 활성화 버튼을 제공하지 않습니다.',
  };
}

export class RomTransferReadinessService {
  async loadChecklist(): Promise<RomTransferReadinessChecklist> {
    if (typeof window === 'undefined') return createDefaultReadinessChecklist();
    try {
      const parsed = JSON.parse(window.localStorage.getItem(browserReadinessKey) || 'null');
      if (parsed?.schemaVersion === 1 && Array.isArray(parsed.items)) return sanitizeForExport(parsed);
    } catch {
      // fall through to default
    }
    return createDefaultReadinessChecklist();
  }

  async saveChecklist(checklist: RomTransferReadinessChecklist): Promise<RomTransferReadinessChecklist> {
    const safe = sanitizeForExport({ ...checklist, updatedAt: new Date().toISOString(), canConsiderRealTransfer: false as const });
    if (typeof window !== 'undefined') window.localStorage.setItem(browserReadinessKey, JSON.stringify(safe));
    return safe;
  }

  setItemStatus(checklist: RomTransferReadinessChecklist, itemId: string, status: RomTransferReadinessStatus): RomTransferReadinessChecklist {
    return {
      ...checklist,
      updatedAt: new Date().toISOString(),
      canConsiderRealTransfer: false,
      items: checklist.items.map((item) => item.id === itemId ? { ...item, status } : item),
    };
  }

  toMarkdown(checklist: RomTransferReadinessChecklist) {
    return [
      '# ROM 실제 전송 기능 검토 체크리스트',
      '',
      `- 업데이트: ${checklist.updatedAt}`,
      '- 실제 전송 활성화 버튼은 없습니다.',
      `- 잠금 메시지: ${checklist.lockedMessage}`,
      '',
      ...checklist.items.map((item) => `- ${item.status === 'passed' ? '[x]' : '[ ]'} ${item.label} (${item.status})`),
    ].join('\n');
  }

  export(checklist: RomTransferReadinessChecklist, format: 'json' | 'markdown') {
    const safe = sanitizeForExport({ ...checklist, canConsiderRealTransfer: false as const });
    return format === 'markdown' ? this.toMarkdown(safe) : JSON.stringify(safe, null, 2);
  }
}
