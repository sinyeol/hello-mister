interface StatusBadgeProps {
  label: string;
  tone?: 'neutral' | 'safe' | 'warning' | 'danger' | 'dry';
}

export function StatusBadge({ label, tone = 'neutral' }: StatusBadgeProps) {
  return <span className={`status-badge badge-${tone}`}>{label}</span>;
}
