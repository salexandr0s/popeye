import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  width?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  keyFn: (row: T) => string;
}

export function DataTable<T>({
  columns,
  data,
  onRowClick,
  keyFn,
}: DataTableProps<T>) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)]">
      <table className="w-full text-[14px]">
        <thead>
          <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-muted)]">
            {columns.map((col) => (
              <th
                key={col.key}
                className="px-[16px] py-[12px] text-left font-medium text-[var(--color-fg-muted)] text-[12px] uppercase tracking-wide"
                style={col.width ? { width: col.width } : undefined}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr
              key={keyFn(row)}
              className={`border-b border-[var(--color-border)] last:border-b-0 transition-colors duration-[var(--duration-fast)] ${
                onRowClick
                  ? 'cursor-pointer hover:bg-[var(--color-bg-muted)]'
                  : ''
              }`}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((col) => (
                <td key={col.key} className="px-[16px] py-[12px]">
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
