interface PlaceholderPanelProps {
  title: string;
  children: React.ReactNode;
}

export function PlaceholderPanel({ title, children }: PlaceholderPanelProps) {
  return (
    <section className="rounded-lg border border-line bg-white p-5 shadow-surface">
      <h3 className="text-base font-semibold">{title}</h3>
      <div className="mt-3 text-sm leading-6 text-neutral-600">{children}</div>
    </section>
  );
}
