import { describe, it, expect } from 'vitest';
import {
  getPeriodDates,
  getPreviousPeriodDates,
  formatDateForShopify,
  buildShopifyDateQuery,
  formatPeriodLabel,
  formatPreviousPeriodLabel,
} from '../utils/dates.js';

describe('getPeriodDates', () => {
  describe('custom period', () => {
    it('returns correct start and end for valid date range', () => {
      const { start, end } = getPeriodDates('custom', '2025-01-01', '2025-01-31');
      expect(start.getUTCFullYear()).toBe(2025);
      expect(start.getUTCMonth()).toBe(0);
      expect(start.getUTCDate()).toBe(1);
      expect(end.getUTCFullYear()).toBe(2025);
      expect(end.getUTCMonth()).toBe(0);
      expect(end.getUTCDate()).toBe(31);
    });

    it('throws when startDate or endDate is missing', () => {
      expect(() => getPeriodDates('custom')).toThrow('startDate and endDate are required');
      expect(() => getPeriodDates('custom', '2025-01-01')).toThrow('startDate and endDate are required');
    });

    it('throws when startDate is after endDate', () => {
      expect(() => getPeriodDates('custom', '2025-02-01', '2025-01-01')).toThrow('startDate must be before');
    });

    it('throws on invalid date format', () => {
      expect(() => getPeriodDates('custom', 'not-a-date', '2025-01-01')).toThrow('Invalid date format');
    });
  });

  describe('dynamic periods', () => {
    it('today: end time is 23:59:59', () => {
      const { start, end } = getPeriodDates('today');
      expect(end.getHours()).toBe(23);
      expect(end.getMinutes()).toBe(59);
      expect(end.getSeconds()).toBe(59);
      expect(start <= end).toBe(true);
    });

    it('yesterday: end time is 23:59:59 and date is before today', () => {
      const { start, end } = getPeriodDates('yesterday');
      expect(end.getHours()).toBe(23);
      expect(end.getMinutes()).toBe(59);
      expect(start <= end).toBe(true);
    });

    it('week: spans 7 days', () => {
      const { start, end } = getPeriodDates('week');
      const diffMs = end.getTime() - start.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      // 6 days gap (today inclusive) + partial day
      expect(diffDays).toBeGreaterThanOrEqual(6);
      expect(diffDays).toBeLessThan(7.1);
    });

    it('month: start is the 1st', () => {
      const { start, end } = getPeriodDates('month');
      expect(start.getDate()).toBe(1);
      expect(start <= end).toBe(true);
    });
  });
});

describe('getPreviousPeriodDates', () => {
  it('previous end is 1ms before current start', () => {
    const start = new Date('2025-01-08T00:00:00Z');
    const end = new Date('2025-01-14T23:59:59.999Z');
    const prev = getPreviousPeriodDates(start, end);
    expect(prev.end.getTime()).toBe(start.getTime() - 1);
  });

  it('preserves duration', () => {
    const start = new Date('2025-01-08T00:00:00Z');
    const end = new Date('2025-01-14T23:59:59.999Z');
    const duration = end.getTime() - start.getTime();
    const prev = getPreviousPeriodDates(start, end);
    const prevDuration = prev.end.getTime() - prev.start.getTime();
    expect(prevDuration).toBe(duration);
  });
});

describe('formatDateForShopify', () => {
  it('returns ISO string', () => {
    const d = new Date('2025-06-15T12:00:00Z');
    expect(formatDateForShopify(d)).toBe(d.toISOString());
  });
});

describe('buildShopifyDateQuery', () => {
  it('contains processed_at with start and end dates', () => {
    const start = new Date('2025-01-01T00:00:00Z');
    const end = new Date('2025-01-31T23:59:59Z');
    const query = buildShopifyDateQuery(start, end);
    expect(query).toContain('processed_at:>=');
    expect(query).toContain('processed_at:<=');
  });
});

describe('formatPeriodLabel', () => {
  const start = new Date('2025-01-01');
  const end = new Date('2025-01-31');

  it('returns "Today" for today period', () => {
    expect(formatPeriodLabel('today', start, end)).toBe('Today');
  });

  it('returns "Yesterday" for yesterday period', () => {
    expect(formatPeriodLabel('yesterday', start, end)).toBe('Yesterday');
  });

  it('returns "Last 7 days" for week period', () => {
    expect(formatPeriodLabel('week', start, end)).toBe('Last 7 days');
  });

  it('returns "This month" for month period', () => {
    expect(formatPeriodLabel('month', start, end)).toBe('This month');
  });

  it('returns date range string for custom period', () => {
    const label = formatPeriodLabel('custom', start, end);
    expect(label).toContain(' - ');
  });
});

describe('formatPreviousPeriodLabel', () => {
  const start = new Date('2025-01-01');
  const end = new Date('2025-01-31');

  it('returns "Yesterday" for today period', () => {
    expect(formatPreviousPeriodLabel('today', start, end)).toBe('Yesterday');
  });

  it('returns "Day before yesterday" for yesterday period', () => {
    expect(formatPreviousPeriodLabel('yesterday', start, end)).toBe('Day before yesterday');
  });

  it('returns "Previous week" for week period', () => {
    expect(formatPreviousPeriodLabel('week', start, end)).toBe('Previous week');
  });

  it('returns "Previous month" for month period', () => {
    expect(formatPreviousPeriodLabel('month', start, end)).toBe('Previous month');
  });
});
