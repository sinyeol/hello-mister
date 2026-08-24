import { useEffect } from 'react';
import { useRomTransfer } from '../../contexts/RomTransferContext';

// Floating, route-independent progress card for the active ROM file transfer. Rendered once in AppLayout so it stays
// visible (and the job stays cancellable) no matter which menu the user is on.
export function RomTransferIndicator() {
  const { job, cancel, dismiss } = useRomTransfer();

  useEffect(() => {
    if (!job || job.status === 'running' || job.status === 'cancelling') return;
    const timer = window.setTimeout(() => dismiss(), 6000);
    return () => window.clearTimeout(timer);
  }, [job, dismiss]);

  if (!job) return null;

  const active = job.status === 'running' || job.status === 'cancelling';
  const percent = job.total > 0 ? Math.min(100, Math.round((job.completed / job.total) * 100)) : 0;
  const failedSuffix = job.failed > 0 ? ` · 실패 ${job.failed}` : '';
  const meta = active
    ? `${job.completed}/${job.total} 완료${failedSuffix}`
    : job.status === 'cancelled'
      ? `취소됨 — ${job.completed}/${job.total} 완료${failedSuffix}`
      : job.failed > 0
        ? `완료 — ${job.completed}/${job.total} (실패 ${job.failed})`
        : `완료 — ${job.completed}개`;

  return (
    <div className={`transfer-indicator transfer-indicator-${job.status}`} role="status" aria-live="polite">
      <div className="transfer-indicator-head">
        <span className="transfer-indicator-title" title={job.title}>{job.title}</span>
        {active ? (
          <button
            type="button"
            className="transfer-indicator-cancel"
            onClick={cancel}
            disabled={job.status === 'cancelling'}
          >
            {job.status === 'cancelling' ? '취소 중…' : '취소'}
          </button>
        ) : (
          <button type="button" className="transfer-indicator-dismiss" onClick={dismiss} aria-label="닫기">×</button>
        )}
      </div>
      <div className="transfer-indicator-track">
        <div className="transfer-indicator-fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="transfer-indicator-meta">{meta}</div>
    </div>
  );
}
