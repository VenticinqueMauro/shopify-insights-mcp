import { describe, it, expect } from 'vitest';
import {
  formatCurrency,
  formatPercentage,
  formatNumber,
  formatCurrencyChange,
} from '../utils/formatting.js';

describe('formatPercentage', () => {
  it('adds + sign for positive values', () => {
    expect(formatPercentage(10)).toBe('+10.0%');
  });

  it('includes - sign for negative values (from toFixed)', () => {
    expect(formatPercentage(-10)).toBe('-10.0%');
  });

  it('returns "0%" for zero — no sign, no decimal (QUAL-03)', () => {
    expect(formatPercentage(0)).toBe('0%');
  });

  it('returns "0%" for negative zero — normalized (QUAL-03)', () => {
    expect(formatPercentage(-0)).toBe('0%');
  });

  it('handles small positive values', () => {
    expect(formatPercentage(0.5)).toBe('+0.5%');
  });

  it('handles small negative values', () => {
    expect(formatPercentage(-0.3)).toBe('-0.3%');
  });
});

describe('formatCurrency', () => {
  it('formats USD with $ sign and 2 decimals', () => {
    expect(formatCurrency(1234.5, 'USD')).toBe('$1,234.50');
  });

  it('defaults to USD when no currency specified', () => {
    expect(formatCurrency(100)).toBe('$100.00');
  });

  it('formats zero', () => {
    expect(formatCurrency(0, 'USD')).toBe('$0.00');
  });
});

describe('formatNumber', () => {
  it('rounds and formats with commas', () => {
    expect(formatNumber(1234567.8)).toBe('1,234,568');
  });

  it('handles zero', () => {
    expect(formatNumber(0)).toBe('0');
  });
});

describe('formatCurrencyChange', () => {
  it('adds + sign for positive amounts', () => {
    expect(formatCurrencyChange(10, 'USD')).toBe('+$10.00');
  });

  it('shows negative sign for negative amounts', () => {
    const result = formatCurrencyChange(-10, 'USD');
    expect(result).toContain('$10.00');
    expect(result).toContain('-');
  });

  it('returns "$0.00" for zero — no + prefix', () => {
    expect(formatCurrencyChange(0, 'USD')).toBe('$0.00');
  });

  it('returns "$0.00" for negative zero — no +$ artifact (QUAL-03)', () => {
    expect(formatCurrencyChange(-0, 'USD')).toBe('$0.00');
  });
});
