import type { ReactNode } from 'react';
import { SectionCard } from '../cards/SectionCard';
import { StatusBadge } from '../status/StatusBadge';
import { formatViewMode, modeMeets, type AppMode } from '../../services/app/viewMode';

interface AdvancedSectionProps {
  title: string;
  description?: string;
  summary?: string;
  tone?: 'default' | 'safe' | 'warning' | 'danger' | 'dry';
  viewMode: AppMode;
  minimumMode?: AppMode;
  children: ReactNode;
}

export function AdvancedSection({ title, description, summary, tone = 'default', viewMode, minimumMode = 'advanced', children }: AdvancedSectionProps) {
  if (modeMeets(viewMode, minimumMode)) {
    return (
      <SectionCard title={title} description={description || summary} tone={tone}>
        {children}
      </SectionCard>
    );
  }

  return (
    <details className={`advanced-section tone-${tone}`}>
      <summary>
        <span>
          <strong>{title}</strong>
          {(summary || description) && <small>{summary || description}</small>}
        </span>
        <StatusBadge label={formatViewMode(minimumMode)} tone="dry" />
      </summary>
      <div className="advanced-section-body">{children}</div>
    </details>
  );
}
