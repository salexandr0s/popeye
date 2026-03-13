interface ErrorDisplayProps {
  message: string;
}

export function ErrorDisplay({ message }: ErrorDisplayProps) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-danger)]/20 bg-[var(--color-danger)]/5 px-[16px] py-[12px]">
      <p className="text-[14px] text-[var(--color-danger)]">{message}</p>
    </div>
  );
}
