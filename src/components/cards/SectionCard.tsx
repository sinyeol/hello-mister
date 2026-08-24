import { useState, type ReactNode } from 'react';

interface SectionCardProps {
  title: string;
  description?: string;
  tone?: 'default' | 'safe' | 'warning' | 'danger' | 'dry';
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  children: ReactNode;
}

export function SectionCard({ title, description, tone = 'default', collapsible = false, defaultCollapsed = false, children }: SectionCardProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <section className={`section-card tone-${tone}`}>
      <div
        className="section-card-header"
        onClick={collapsible ? () => setCollapsed((c) => !c) : undefined}
        style={collapsible ? { cursor: 'pointer', userSelect: 'none' } : undefined}
      >
        <h3>{collapsible ? (collapsed ? '▸ ' : '▾ ') : ''}{title}</h3>
        {description && (!collapsible || !collapsed) && <p>{description}</p>}
      </div>
      {(!collapsible || !collapsed) && children}
    </section>
  );
}
