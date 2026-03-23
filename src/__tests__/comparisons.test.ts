import { describe, it, expect } from 'vitest';
import { calculateChange } from '../analytics/comparisons.js';

describe('calculateChange', () => {
  it('returns up when current > previous by more than 0.05%', () => {
    const result = calculateChange(110, 100);
    expect(result.direction).toBe('up');
    expect(result.percentage).toBeCloseTo(10, 1);
    expect(result.value).toBe(10);
  });

  it('returns down when current < previous by more than 0.05%', () => {
    const result = calculateChange(90, 100);
    expect(result.direction).toBe('down');
    expect(result.percentage).toBeCloseTo(-10, 1);
    expect(result.value).toBe(-10);
  });

  it('returns flat when change is within +/-0.05% threshold', () => {
    const result = calculateChange(100.01, 100);
    expect(result.direction).toBe('flat');
  });

  it('returns up with percentage=100 when previous is 0 and current > 0', () => {
    const result = calculateChange(50, 0);
    expect(result.direction).toBe('up');
    expect(result.percentage).toBe(100);
    expect(result.value).toBe(50);
  });

  it('returns flat with percentage=0 when both are 0', () => {
    const result = calculateChange(0, 0);
    expect(result.direction).toBe('flat');
    expect(result.percentage).toBe(0);
    expect(result.value).toBe(0);
  });

  it('value field equals current minus previous', () => {
    const result = calculateChange(250, 200);
    expect(result.value).toBe(50);
  });

  it('boundary: exactly 0.05% up is flat', () => {
    // 0.05% of 100000 = 50, so current = 100050
    const result = calculateChange(100050, 100000);
    expect(result.direction).toBe('flat');
  });

  it('boundary: just above 0.05% up is up', () => {
    // 0.051% of 100000 = 51
    const result = calculateChange(100051, 100000);
    expect(result.direction).toBe('up');
  });
});
