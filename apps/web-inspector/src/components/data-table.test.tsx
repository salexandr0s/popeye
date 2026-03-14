// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DataTable } from './data-table';
import type { Column } from './data-table';

afterEach(cleanup);

interface TestRow {
  id: string;
  name: string;
  status: string;
}

const testColumns: Column<TestRow>[] = [
  { key: 'id', header: 'ID', render: (row) => row.id },
  { key: 'name', header: 'Name', render: (row) => row.name },
  { key: 'status', header: 'Status', render: (row) => row.status },
];

const testData: TestRow[] = [
  { id: '1', name: 'Alpha', status: 'active' },
  { id: '2', name: 'Beta', status: 'inactive' },
  { id: '3', name: 'Gamma', status: 'pending' },
];

describe('DataTable', () => {
  it('renders column headers', () => {
    render(
      <DataTable
        columns={testColumns}
        data={testData}
        keyFn={(row) => row.id}
      />,
    );

    expect(screen.getByText('ID')).toBeDefined();
    expect(screen.getByText('Name')).toBeDefined();
    expect(screen.getByText('Status')).toBeDefined();
  });

  it('renders data rows', () => {
    render(
      <DataTable
        columns={testColumns}
        data={testData}
        keyFn={(row) => row.id}
      />,
    );

    expect(screen.getByText('Alpha')).toBeDefined();
    expect(screen.getByText('Beta')).toBeDefined();
    expect(screen.getByText('Gamma')).toBeDefined();
    expect(screen.getByText('active')).toBeDefined();
    expect(screen.getByText('inactive')).toBeDefined();
    expect(screen.getByText('pending')).toBeDefined();
  });

  it('renders correct number of rows', () => {
    const { container } = render(
      <DataTable
        columns={testColumns}
        data={testData}
        keyFn={(row) => row.id}
      />,
    );

    const rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(3);
  });

  it('calls onRowClick when a row is clicked', () => {
    const handleClick = vi.fn();

    render(
      <DataTable
        columns={testColumns}
        data={testData}
        onRowClick={handleClick}
        keyFn={(row) => row.id}
      />,
    );

    fireEvent.click(screen.getByText('Alpha'));
    expect(handleClick).toHaveBeenCalledTimes(1);
    expect(handleClick).toHaveBeenCalledWith(testData[0]);
  });

  it('calls onRowClick with the correct row data', () => {
    const handleClick = vi.fn();

    render(
      <DataTable
        columns={testColumns}
        data={testData}
        onRowClick={handleClick}
        keyFn={(row) => row.id}
      />,
    );

    fireEvent.click(screen.getByText('Beta'));
    expect(handleClick).toHaveBeenCalledWith(testData[1]);

    fireEvent.click(screen.getByText('Gamma'));
    expect(handleClick).toHaveBeenCalledWith(testData[2]);
  });

  it('does not add cursor-pointer class when onRowClick is not provided', () => {
    const { container } = render(
      <DataTable
        columns={testColumns}
        data={testData}
        keyFn={(row) => row.id}
      />,
    );

    const rows = container.querySelectorAll('tbody tr');
    rows.forEach((row) => {
      expect(row.className).not.toContain('cursor-pointer');
    });
  });

  it('renders empty table when data is empty', () => {
    const { container } = render(
      <DataTable
        columns={testColumns}
        data={[]}
        keyFn={(row) => row.id}
      />,
    );

    const headerCells = container.querySelectorAll('thead th');
    expect(headerCells.length).toBe(3);

    const rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(0);
  });
});
