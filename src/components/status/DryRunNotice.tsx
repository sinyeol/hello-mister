export function DryRunNotice() {
  return (
    <div className="dry-run-notice" role="status">
      <strong>안전 모드</strong>
      <span>실제 디스크 쓰기, 포맷, 플래시, 원격 reboot, 원격 파일 덮어쓰기는 아직 실행하지 않습니다.</span>
    </div>
  );
}
