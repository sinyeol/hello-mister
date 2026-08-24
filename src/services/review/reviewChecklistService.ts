import type {
  ReviewChecklist,
  ReviewChecklistGrade,
  ReviewChecklistItem,
  ReviewChecklistStatus,
} from '../../types/review';
import { sanitizeForExport } from '../rom/exportSanitizer';

const misterChecklistKey = 'hello-mister-v2-mister-readonly-review-checklist';
const romChecklistKey = 'hello-mister-v2-rom-dry-run-review-checklist';

const misterReadOnlyItems: Array<Omit<ReviewChecklistItem, 'status'>> = [
  { id: 'same-network', label: 'MiSTer가 같은 네트워크에 있음', required: true },
  { id: 'discovery-candidate', label: '자동검색 후보에 나타남', required: true },
  { id: 'session-credential', label: 'SSH/SFTP 세션 인증 입력', required: true },
  { id: 'first-host-key-review', label: 'host key 최초 신뢰 확인', required: true },
  { id: 'host-key-trusted', label: 'host key trusted 상태 확인', required: true },
  { id: 'media-fat', label: '/media/fat 구조 확인', required: true },
  { id: 'ini-preview', label: 'MiSTer.ini 미리보기 성공', required: true },
  { id: 'games-list', label: 'games 1단계 폴더 조회 성공', required: true },
  { id: 'scripts-list', label: 'Scripts 목록 조회 성공', required: true },
  { id: 'integration-test', label: 'read-only 통합 테스트 성공 또는 부분 성공', required: true },
  { id: 'diagnostic-export', label: '진단 패키지 내보내기 성공', required: true },
  { id: 'task-log', label: '작업 로그에 기록됨', required: true },
  { id: 'credential-not-saved', label: '인증 정보가 저장되지 않음 확인', required: true },
  { id: 'remote-write-locked', label: '원격 쓰기 기능이 잠겨 있음 확인', required: true },
];

const romDryRunItems: Array<Omit<ReviewChecklistItem, 'status'>> = [
  { id: 'real-rom-folder', label: '실제 ROM 폴더 선택', required: true },
  { id: 'bulk-warning', label: '대량 ROM 스캔 경고 확인', required: true },
  { id: 'recursive-opt-in', label: '재귀 스캔 opt-in 확인', required: true },
  { id: 'platform-recommendation', label: '플랫폼 추천 확인', required: true },
  { id: 'zip-not-auto', label: '.zip/.7z 자동 확정 금지 확인', required: true },
  { id: 'disc-not-auto', label: '.cue/.bin/.chd/.iso/.vhd 자동 확정 금지 확인', required: true },
  { id: 'remote-games-snapshot', label: '원격 games 폴더 snapshot 성공', required: true },
  { id: 'target-folder-missing', label: '대상 폴더 없음 항목 확인', required: true },
  { id: 'same-name-same-size', label: '같은 이름/같은 크기 충돌 확인', required: true },
  { id: 'same-name-different-size', label: '같은 이름/다른 크기 충돌 확인', required: true },
  { id: 'storage-dry-run', label: '저장공간 dry-run 확인', required: true },
  { id: 'backup-plan', label: '백업 계획 확인', required: true },
  { id: 'final-confirmation', label: '최종 확인 modal 확인', required: true },
  { id: 'simulation-scenarios', label: 'simulated transfer 성공/취소/실패 시나리오 확인', required: true },
  { id: 'dry-run-report-export', label: 'dry-run 리포트 내보내기 확인', required: true },
  { id: 'real-copy-locked', label: '실제 복사 버튼이 잠겨 있음 확인', required: true },
];

export function calculateReviewChecklistGrade(items: ReviewChecklistItem[], transferFocused = false): ReviewChecklistGrade {
  if (items.some((item) => item.status === 'failed')) return 'needs-fix';
  const required = items.filter((item) => item.required);
  const requiredPassed = required.every((item) => item.status === 'passed' || item.status === 'not-applicable');
  if (requiredPassed && required.length > 0) return transferFocused ? 'ready-to-consider-transfer' : 'review-complete';
  if (items.some((item) => item.status !== 'unchecked')) return 'in-review';
  return 'not-started';
}

export function formatReviewChecklistGrade(grade: ReviewChecklistGrade) {
  const labels: Record<ReviewChecklistGrade, string> = {
    'not-started': '검토 전',
    'in-review': '검토 중',
    'review-complete': '검토 완료',
    'needs-fix': '수정 필요',
    'ready-to-consider-transfer': '실제 전송 검토 가능',
  };
  return labels[grade];
}

function createChecklist(
  id: string,
  title: string,
  items: Array<Omit<ReviewChecklistItem, 'status'>>,
  transferFocused = false,
): ReviewChecklist {
  const checklistItems = items.map((item) => ({ ...item, status: 'unchecked' as const }));
  return {
    schemaVersion: 1,
    id,
    title,
    updatedAt: new Date().toISOString(),
    userNote: '',
    grade: calculateReviewChecklistGrade(checklistItems, transferFocused),
    items: checklistItems,
  };
}

export class ReviewChecklistService {
  private storageKey: string;
  private transferFocused: boolean;
  private defaultChecklist: ReviewChecklist;

  constructor(kind: 'mister-readonly' | 'rom-dry-run') {
    this.storageKey = kind === 'mister-readonly' ? misterChecklistKey : romChecklistKey;
    this.transferFocused = kind === 'rom-dry-run';
    this.defaultChecklist = kind === 'mister-readonly'
      ? createChecklist('mister-readonly-review', '실제 MiSTer read-only 검토 체크리스트', misterReadOnlyItems)
      : createChecklist('rom-dry-run-review', 'ROM dry-run 실사용 검토 체크리스트', romDryRunItems, true);
  }

  load(): ReviewChecklist {
    if (typeof window === 'undefined') return this.defaultChecklist;
    try {
      const parsed = JSON.parse(window.localStorage.getItem(this.storageKey) || 'null') as ReviewChecklist | null;
      if (parsed?.schemaVersion === 1 && Array.isArray(parsed.items)) {
        const withGrade = {
          ...parsed,
          grade: calculateReviewChecklistGrade(parsed.items, this.transferFocused),
        };
        return sanitizeForExport(withGrade);
      }
    } catch {
      // fall back to default
    }
    return this.defaultChecklist;
  }

  save(checklist: ReviewChecklist): ReviewChecklist {
    const next = sanitizeForExport({
      ...checklist,
      updatedAt: new Date().toISOString(),
      grade: calculateReviewChecklistGrade(checklist.items, this.transferFocused),
    });
    if (typeof window !== 'undefined') window.localStorage.setItem(this.storageKey, JSON.stringify(next));
    return next;
  }

  setStatus(checklist: ReviewChecklist, itemId: string, status: ReviewChecklistStatus): ReviewChecklist {
    return this.save({
      ...checklist,
      items: checklist.items.map((item) => item.id === itemId ? { ...item, status } : item),
    });
  }

  setNote(checklist: ReviewChecklist, userNote: string): ReviewChecklist {
    return this.save({ ...checklist, userNote });
  }

  export(checklist: ReviewChecklist, format: 'json' | 'markdown') {
    const safe = sanitizeForExport({
      ...checklist,
      grade: calculateReviewChecklistGrade(checklist.items, this.transferFocused),
    });
    if (format === 'json') return JSON.stringify(safe, null, 2);
    return [
      `# ${safe.title}`,
      '',
      `- 상태: ${formatReviewChecklistGrade(safe.grade)}`,
      `- 업데이트: ${safe.updatedAt}`,
      '- password/privateKey/passphrase/token/raw command는 포함하지 않습니다.',
      '',
      ...safe.items.map((item) => `- ${item.status === 'passed' ? '[x]' : '[ ]'} ${item.label} (${item.status})`),
      '',
      safe.userNote ? `## 메모\n${safe.userNote}` : '## 메모\n없음',
    ].join('\n');
  }
}
