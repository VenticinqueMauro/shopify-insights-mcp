import { calculateChange } from './comparisons.js';

export interface SalesMetrics {
  revenue: number;
  orders: number;
  averageOrderValue: number;
  itemsSold: number;
}

export interface SalesSignals {
  revenueDown: boolean;
  revenueUp: boolean;
  ordersDown: boolean;
  ordersUp: boolean;
  aovDown: boolean;
  noSales: boolean;
  stableRevenue: boolean;
}

export interface SalesInsightResult {
  insights: string[];
  signals: SalesSignals;
}

// Default signals for when there's no comparison period
const NO_COMPARISON_SIGNALS: SalesSignals = {
  revenueDown: false,
  revenueUp: false,
  ordersDown: false,
  ordersUp: false,
  aovDown: false,
  noSales: false,
  stableRevenue: false,
};

export function generateSalesInsights(
  current: SalesMetrics,
  previous?: SalesMetrics
): SalesInsightResult {
  const insights: string[] = [];

  // No previous period — limited signals
  if (!previous) {
    const noSales = current.revenue === 0;
    if (noSales) {
      insights.push('📭 No sales were recorded in the selected period.');
    } else {
      insights.push(`💰 ${current.orders} orders placed with an average order value of $${current.averageOrderValue.toFixed(2)}.`);
      insights.push(`📦 ${current.itemsSold} units sold in total.`);
    }
    return {
      insights,
      signals: { ...NO_COMPARISON_SIGNALS, noSales },
    };
  }

  // Compute changes
  const revenueChange = calculateChange(current.revenue, previous.revenue);
  const ordersChange = calculateChange(current.orders, previous.orders);
  const aovChange = calculateChange(current.averageOrderValue, previous.averageOrderValue);
  const itemsChange = calculateChange(current.itemsSold, previous.itemsSold);

  // STEP 1: Set ALL signals from calculateChange results BEFORE building strings
  const signals: SalesSignals = {
    revenueDown: revenueChange.direction === 'down',
    revenueUp: revenueChange.direction === 'up',
    ordersDown: ordersChange.direction === 'down',
    ordersUp: ordersChange.direction === 'up',
    aovDown: aovChange.direction === 'down',
    noSales: current.revenue === 0,
    stableRevenue: revenueChange.direction === 'flat' && current.revenue > 0,
  };

  // STEP 2: Build insight strings (in English)
  if (revenueChange.direction === 'up') {
    insights.push(`📈 Revenue increased ${revenueChange.percentage.toFixed(1)}% compared to the previous period.`);
  } else if (revenueChange.direction === 'down') {
    insights.push(`📉 Revenue decreased ${Math.abs(revenueChange.percentage).toFixed(1)}% compared to the previous period.`);
  } else {
    insights.push('➡️ Revenue remained stable compared to the previous period.');
  }

  if (ordersChange.direction === 'up') {
    insights.push(`🛒 Order volume increased ${ordersChange.percentage.toFixed(1)}% (${ordersChange.value > 0 ? '+' : ''}${Math.round(ordersChange.value)} orders).`);
  } else if (ordersChange.direction === 'down') {
    insights.push(`🛒 Order volume decreased ${Math.abs(ordersChange.percentage).toFixed(1)}% (${Math.round(ordersChange.value)} orders).`);
  }

  if (aovChange.direction === 'up') {
    insights.push(`💳 Average order value increased ${aovChange.percentage.toFixed(1)}%, indicating higher value per transaction.`);
  } else if (aovChange.direction === 'down') {
    insights.push(`💳 Average order value decreased ${Math.abs(aovChange.percentage).toFixed(1)}% — consider upselling strategies.`);
  }

  if (itemsChange.direction === 'up') {
    insights.push(`📦 ${Math.round(itemsChange.value)} more units sold compared to the previous period.`);
  } else if (itemsChange.direction === 'down') {
    insights.push(`📦 ${Math.abs(Math.round(itemsChange.value))} fewer units sold compared to the previous period.`);
  }

  if (insights.length === 0) {
    insights.push('📊 Performance was similar to the previous period.');
  }

  return { insights, signals };
}
