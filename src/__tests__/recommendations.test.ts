import { describe, it, expect } from 'vitest';
import { generateSalesRecommendations } from '../analytics/recommendations.js';
import type { SalesSignals } from '../analytics/insights.js';

function makeSignals(overrides: Partial<SalesSignals> = {}): SalesSignals {
  return {
    revenueDown: false,
    revenueUp: false,
    ordersDown: false,
    ordersUp: false,
    aovDown: false,
    noSales: false,
    stableRevenue: false,
    ...overrides,
  };
}

describe('generateSalesRecommendations', () => {
  it('always includes the monitor metrics recommendation as the last item', () => {
    const result = generateSalesRecommendations(makeSignals());
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[result.length - 1]).toContain('Monitor key metrics daily');
  });

  it('fires promotional + email recs when revenueDown', () => {
    const result = generateSalesRecommendations(makeSignals({ revenueDown: true }));
    expect(result.some(r => r.includes('promotional campaign'))).toBe(true);
    expect(result.some(r => r.includes('email marketing'))).toBe(true);
  });

  it('fires promotional + email recs when ordersDown', () => {
    const result = generateSalesRecommendations(makeSignals({ ordersDown: true }));
    expect(result.some(r => r.includes('promotional campaign'))).toBe(true);
    expect(result.some(r => r.includes('email marketing'))).toBe(true);
  });

  it('fires bundle + shipping recs when aovDown', () => {
    const result = generateSalesRecommendations(makeSignals({ aovDown: true }));
    expect(result.some(r => r.includes('bundles'))).toBe(true);
    expect(result.some(r => r.includes('free shipping'))).toBe(true);
  });

  it('fires momentum + analyze recs when revenueUp', () => {
    const result = generateSalesRecommendations(makeSignals({ revenueUp: true }));
    expect(result.some(r => r.includes('positive momentum'))).toBe(true);
    expect(result.some(r => r.includes('Analyze'))).toBe(true);
  });

  it('fires momentum + analyze + stock recs when ordersUp', () => {
    const result = generateSalesRecommendations(makeSignals({ ordersUp: true }));
    expect(result.some(r => r.includes('positive momentum'))).toBe(true);
    expect(result.some(r => r.includes('sufficient stock'))).toBe(true);
  });

  it('fires review channels + A/B recs when noSales', () => {
    const result = generateSalesRecommendations(makeSignals({ noSales: true }));
    expect(result.some(r => r.includes('marketing channels'))).toBe(true);
    expect(result.some(r => r.includes('A/B tests'))).toBe(true);
  });

  it('fires review channels + A/B recs when stableRevenue', () => {
    const result = generateSalesRecommendations(makeSignals({ stableRevenue: true }));
    expect(result.some(r => r.includes('marketing channels'))).toBe(true);
    expect(result.some(r => r.includes('A/B tests'))).toBe(true);
  });

  it('with all signals false, only returns monitor metrics', () => {
    const result = generateSalesRecommendations(makeSignals());
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('Monitor key metrics daily');
  });

  it('does not duplicate the stock rec when both revenueUp and ordersUp', () => {
    const result = generateSalesRecommendations(makeSignals({ revenueUp: true, ordersUp: true }));
    const stockRecs = result.filter(r => r.includes('sufficient stock'));
    expect(stockRecs).toHaveLength(1);
  });
});
