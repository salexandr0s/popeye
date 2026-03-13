export function formatTime(iso: string | null): string {
  if (!iso) return '--';
  return new Date(iso).toLocaleString();
}
