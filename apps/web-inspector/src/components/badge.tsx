interface BadgeProps {
  state: string;
}

const stateColors: Record<string, { dot: string; bg: string; text: string }> = {
  running: {
    dot: 'bg-[var(--color-accent)]',
    bg: 'bg-[var(--color-accent)]/10',
    text: 'text-[var(--color-accent)]',
  },
  starting: {
    dot: 'bg-[var(--color-accent)]',
    bg: 'bg-[var(--color-accent)]/10',
    text: 'text-[var(--color-accent)]',
  },
  succeeded: {
    dot: 'bg-[var(--color-success)]',
    bg: 'bg-[var(--color-success)]/10',
    text: 'text-[var(--color-success)]',
  },
  failed: {
    dot: 'bg-[var(--color-danger)]',
    bg: 'bg-[var(--color-danger)]/10',
    text: 'text-[var(--color-danger)]',
  },
  failed_final: {
    dot: 'bg-[var(--color-danger)]',
    bg: 'bg-[var(--color-danger)]/10',
    text: 'text-[var(--color-danger)]',
  },
  failed_retryable: {
    dot: 'bg-[var(--color-danger)]',
    bg: 'bg-[var(--color-danger)]/10',
    text: 'text-[var(--color-danger)]',
  },
  cancelled: {
    dot: 'bg-[var(--color-fg-muted)]',
    bg: 'bg-[var(--color-fg-muted)]/10',
    text: 'text-[var(--color-fg-muted)]',
  },
  abandoned: {
    dot: 'bg-[var(--color-fg-muted)]',
    bg: 'bg-[var(--color-fg-muted)]/10',
    text: 'text-[var(--color-fg-muted)]',
  },
  paused: {
    dot: 'bg-[var(--color-warning)]',
    bg: 'bg-[var(--color-warning)]/10',
    text: 'text-[var(--color-warning)]',
  },
  blocked_operator: {
    dot: 'bg-[var(--color-warning)]',
    bg: 'bg-[var(--color-warning)]/10',
    text: 'text-[var(--color-warning)]',
  },
  idle: {
    dot: 'bg-[var(--color-warning)]',
    bg: 'bg-[var(--color-warning)]/10',
    text: 'text-[var(--color-warning)]',
  },
  'stuck-risk': {
    dot: 'bg-[var(--color-danger)]',
    bg: 'bg-[var(--color-danger)]/10',
    text: 'text-[var(--color-danger)]',
  },
  queued: {
    dot: 'bg-[var(--color-fg-muted)]',
    bg: 'bg-[var(--color-fg-muted)]/10',
    text: 'text-[var(--color-fg-muted)]',
  },
  waiting_retry: {
    dot: 'bg-[var(--color-fg-muted)]',
    bg: 'bg-[var(--color-fg-muted)]/10',
    text: 'text-[var(--color-fg-muted)]',
  },
  leased: {
    dot: 'bg-[var(--color-fg-muted)]',
    bg: 'bg-[var(--color-fg-muted)]/10',
    text: 'text-[var(--color-fg-muted)]',
  },
  open: {
    dot: 'bg-[var(--color-warning)]',
    bg: 'bg-[var(--color-warning)]/10',
    text: 'text-[var(--color-warning)]',
  },
  pending: {
    dot: 'bg-[var(--color-warning)]',
    bg: 'bg-[var(--color-warning)]/10',
    text: 'text-[var(--color-warning)]',
  },
  approved: {
    dot: 'bg-[var(--color-success)]',
    bg: 'bg-[var(--color-success)]/10',
    text: 'text-[var(--color-success)]',
  },
  active: {
    dot: 'bg-[var(--color-success)]',
    bg: 'bg-[var(--color-success)]/10',
    text: 'text-[var(--color-success)]',
  },
  denied: {
    dot: 'bg-[var(--color-danger)]',
    bg: 'bg-[var(--color-danger)]/10',
    text: 'text-[var(--color-danger)]',
  },
  revoked: {
    dot: 'bg-[var(--color-danger)]',
    bg: 'bg-[var(--color-danger)]/10',
    text: 'text-[var(--color-danger)]',
  },
  expired: {
    dot: 'bg-[var(--color-fg-muted)]',
    bg: 'bg-[var(--color-fg-muted)]/10',
    text: 'text-[var(--color-fg-muted)]',
  },
  closed: {
    dot: 'bg-[var(--color-fg-muted)]',
    bg: 'bg-[var(--color-fg-muted)]/10',
    text: 'text-[var(--color-fg-muted)]',
  },
  sealed: {
    dot: 'bg-[var(--color-danger)]',
    bg: 'bg-[var(--color-danger)]/10',
    text: 'text-[var(--color-danger)]',
  },
  resolved: {
    dot: 'bg-[var(--color-success)]',
    bg: 'bg-[var(--color-success)]/10',
    text: 'text-[var(--color-success)]',
  },
};

const defaultColor = {
  dot: 'bg-[var(--color-fg-muted)]',
  bg: 'bg-[var(--color-fg-muted)]/10',
  text: 'text-[var(--color-fg-muted)]',
};

export function Badge({ state }: BadgeProps) {
  const colors = stateColors[state] ?? defaultColor;

  return (
    <span
      className={`inline-flex items-center gap-[6px] px-[8px] py-[2px] rounded-full text-[12px] font-medium ${colors.bg} ${colors.text}`}
    >
      <span className={`inline-block w-[6px] h-[6px] rounded-full ${colors.dot}`} />
      {state.replace(/_/g, ' ')}
    </span>
  );
}
