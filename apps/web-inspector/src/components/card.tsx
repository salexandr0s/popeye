interface CardProps {
  label: string;
  value: string | number;
  description?: string;
}

export function Card({ label, value, description }: CardProps) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[20px] shadow-[var(--shadow-sm)]">
      <p className="text-[12px] font-medium text-[var(--color-fg-muted)] uppercase tracking-wide">
        {label}
      </p>
      <p className="mt-[4px] text-[24px] font-semibold text-[var(--color-fg)]">
        {value}
      </p>
      {description ? (
        <p className="mt-[4px] text-[12px] text-[var(--color-fg-muted)]">
          {description}
        </p>
      ) : null}
    </div>
  );
}
