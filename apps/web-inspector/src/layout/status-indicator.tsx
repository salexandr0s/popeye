import { useHealth } from '../api/hooks';

export function StatusIndicator() {
  const { data } = useHealth();

  const isHealthy = data?.ok === true;

  return (
    <span className="flex items-center gap-[8px] text-[12px] text-[var(--color-fg-muted)]">
      <span
        className={`inline-block w-[8px] h-[8px] rounded-full ${
          isHealthy
            ? 'bg-[var(--color-success)]'
            : 'bg-[var(--color-danger)]'
        }`}
      />
      {isHealthy ? 'Healthy' : 'Unreachable'}
    </span>
  );
}
