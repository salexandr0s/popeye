// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Badge } from './badge';

afterEach(cleanup);

describe('Badge', () => {
  it('renders state text with underscores replaced by spaces', () => {
    render(<Badge state="failed_final" />);
    expect(screen.getByText('failed final')).toBeDefined();
  });

  it('renders single-word state text as-is', () => {
    render(<Badge state="running" />);
    expect(screen.getByText('running')).toBeDefined();
  });

  it('applies success color classes for succeeded state', () => {
    const { container } = render(<Badge state="succeeded" />);
    const badge = container.querySelector('span');
    expect(badge).not.toBeNull();
    expect(badge!.className).toContain('color-success');
  });

  it('applies danger color classes for failed state', () => {
    const { container } = render(<Badge state="failed" />);
    const badge = container.querySelector('span');
    expect(badge).not.toBeNull();
    expect(badge!.className).toContain('color-danger');
  });

  it('applies danger color classes for failed_final state', () => {
    const { container } = render(<Badge state="failed_final" />);
    const badge = container.querySelector('span');
    expect(badge).not.toBeNull();
    expect(badge!.className).toContain('color-danger');
  });

  it('applies danger color classes for failed_retryable state', () => {
    const { container } = render(<Badge state="failed_retryable" />);
    const badge = container.querySelector('span');
    expect(badge).not.toBeNull();
    expect(badge!.className).toContain('color-danger');
  });

  it('applies muted color classes for unknown state', () => {
    const { container } = render(<Badge state="some_unknown_state" />);
    const badge = container.querySelector('span');
    expect(badge).not.toBeNull();
    expect(badge!.className).toContain('color-fg-muted');
    expect(screen.getByText('some unknown state')).toBeDefined();
  });

  it('renders the dot indicator element', () => {
    const { container } = render(<Badge state="running" />);
    const dots = container.querySelectorAll('span > span');
    expect(dots.length).toBe(1);
    expect(dots[0]!.className).toContain('rounded-full');
  });
});
