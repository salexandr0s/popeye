// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { formatTime } from './format';

describe('formatTime', () => {
  it('returns "--" for null input', () => {
    expect(formatTime(null)).toBe('--');
  });

  it('returns "--" for empty string input', () => {
    expect(formatTime('')).toBe('--');
  });

  it('formats a valid ISO date string', () => {
    const iso = '2024-06-15T10:30:00.000Z';
    const result = formatTime(iso);
    // toLocaleString output varies by locale, but it should not be "--"
    expect(result).not.toBe('--');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns a string containing date components for a known date', () => {
    const iso = '2024-01-01T00:00:00.000Z';
    const result = formatTime(iso);
    // The result should contain "2024" somewhere (year)
    expect(result).toContain('2024');
  });
});
