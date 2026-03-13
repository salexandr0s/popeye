interface EmptyStateProps {
  title: string;
  description?: string;
}

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-[32px] text-center">
      <p className="text-[16px] font-medium text-[var(--color-fg)]">{title}</p>
      {description ? (
        <p className="mt-[8px] text-[14px] text-[var(--color-fg-muted)]">
          {description}
        </p>
      ) : null}
    </div>
  );
}
