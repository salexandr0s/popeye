interface PageHeaderProps {
  title: string;
  description?: string;
}

export function PageHeader({ title, description }: PageHeaderProps) {
  return (
    <div className="mb-[24px]">
      <h1 className="text-[24px] font-semibold text-[var(--color-fg)]">
        {title}
      </h1>
      {description ? (
        <p className="mt-[4px] text-[14px] text-[var(--color-fg-muted)]">
          {description}
        </p>
      ) : null}
    </div>
  );
}
