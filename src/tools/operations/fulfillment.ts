import { z } from 'zod';
import { fetchAllPages } from '../../shopify/client.js';
import { ORDERS_BY_DATE_RANGE } from '../../shopify/queries/orders.js';
import { getPeriodDates, buildShopifyDateQuery, formatPeriodLabel, type Period } from '../../utils/dates.js';
import { formatCurrency, formatPercentage, formatNumber } from '../../utils/formatting.js';
import { handleToolError } from '../../utils/errors.js';
import type { ShopifyOrder, OrdersQueryResult, ToolResult } from '../../types/shopify.js';

// Tool definition
export const fulfillmentMetricsTool = {
  name: 'get_fulfillment_metrics',
  description:
    'Get operational metrics: fulfillment status breakdown, financial status distribution, average order value by status, and operational health indicators.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      period: {
        type: 'string',
        enum: ['today', 'yesterday', 'week', 'month', 'custom'],
        description: 'Time period to analyze',
      },
      startDate: {
        type: 'string',
        format: 'date',
        description: 'Start date — only required when period is "custom"',
      },
      endDate: {
        type: 'string',
        format: 'date',
        description: 'End date — only required when period is "custom"',
      },
    },
    required: ['period'],
  },
};

const FulfillmentMetricsSchema = z.object({
  period: z.enum(['today', 'yesterday', 'week', 'month', 'custom']),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

interface StatusCount {
  status: string;
  count: number;
  revenue: number;
  percentage: number;
}

interface FulfillmentSignals {
  lowFulfillmentRate: boolean;     // fulfillmentRate < 70
  mediumFulfillmentRate: boolean;  // fulfillmentRate >= 70 && < 90
  highFulfillmentRate: boolean;    // fulfillmentRate >= 90
  hasRefunds: boolean;             // refundCount > 0
  hasLowPaymentRate: boolean;      // paidRate < 80
}

function buildStatusBreakdown(orders: ShopifyOrder[], getter: (o: ShopifyOrder['node']) => string | null): StatusCount[] {
  const map = new Map<string, { count: number; revenue: number }>();

  for (const { node: order } of orders) {
    const status = getter(order) || 'UNKNOWN';
    const existing = map.get(status) || { count: 0, revenue: 0 };
    existing.count += 1;
    existing.revenue += parseFloat(order.totalPriceSet.shopMoney.amount);
    map.set(status, existing);
  }

  const total = orders.length;
  const result: StatusCount[] = [];

  for (const [status, data] of map.entries()) {
    result.push({
      status,
      count: data.count,
      revenue: data.revenue,
      percentage: total > 0 ? (data.count / total) * 100 : 0,
    });
  }

  return result.sort((a, b) => b.count - a.count);
}

const fulfillmentLabels: Record<string, string> = {
  FULFILLED: 'Shipped',
  UNFULFILLED: 'Unfulfilled',
  PARTIALLY_FULFILLED: 'Partially Fulfilled',
  UNKNOWN: 'Unknown',
};

const financialLabels: Record<string, string> = {
  PAID: 'Paid',
  PENDING: 'Pending',
  REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Partially Refunded',
  VOIDED: 'Voided',
  AUTHORIZED: 'Authorized',
  PARTIALLY_PAID: 'Partially Paid',
  UNKNOWN: 'Unknown',
};

interface FulfillmentInsightResult {
  insights: string[];
  signals: FulfillmentSignals;
}

function generateFulfillmentInsights(
  orders: ShopifyOrder[],
  fulfillmentBreakdown: StatusCount[],
  financialBreakdown: StatusCount[]
): FulfillmentInsightResult {
  const insights: string[] = [];
  const total = orders.length;

  if (total === 0) {
    insights.push('No orders found in the selected period.');
    const signals: FulfillmentSignals = {
      lowFulfillmentRate: false,
      mediumFulfillmentRate: false,
      highFulfillmentRate: false,
      hasRefunds: false,
      hasLowPaymentRate: false,
    };
    return { insights, signals };
  }

  // Compute rates
  const fulfilled = fulfillmentBreakdown.find((s) => s.status === 'FULFILLED');
  const fulfillmentRate = fulfilled ? (fulfilled.count / total) * 100 : 0;

  const paid = financialBreakdown.find((s) => s.status === 'PAID');
  const paidRate = paid ? (paid.count / total) * 100 : 0;

  const refunded = financialBreakdown.filter((s) =>
    s.status === 'REFUNDED' || s.status === 'PARTIALLY_REFUNDED'
  );
  const refundCount = refunded.reduce((sum, s) => sum + s.count, 0);

  // STEP 1: Set ALL signals BEFORE building strings
  const signals: FulfillmentSignals = {
    lowFulfillmentRate: fulfillmentRate < 70,
    mediumFulfillmentRate: fulfillmentRate >= 70 && fulfillmentRate < 90,
    highFulfillmentRate: fulfillmentRate >= 90,
    hasRefunds: refundCount > 0,
    hasLowPaymentRate: paidRate < 80,
  };

  // STEP 2: Build English insight strings
  if (signals.highFulfillmentRate) {
    insights.push(`Excellent fulfillment rate: ${fulfillmentRate.toFixed(1)}% of orders shipped.`);
  } else if (signals.mediumFulfillmentRate) {
    insights.push(`Acceptable fulfillment rate: ${fulfillmentRate.toFixed(1)}%. There is room for improvement.`);
  } else {
    insights.push(`Low fulfillment rate: ${fulfillmentRate.toFixed(1)}%. Requires immediate attention.`);
  }

  // Unfulfilled orders
  const unfulfilled = fulfillmentBreakdown.find((s) => s.status === 'UNFULFILLED' || s.status === 'UNKNOWN');
  if (unfulfilled && unfulfilled.count > 0) {
    insights.push(`${unfulfilled.count} order(s) pending fulfillment (${unfulfilled.percentage.toFixed(1)}% of total).`);
  }

  // Financial health
  if (signals.hasLowPaymentRate) {
    insights.push(`Only ${paidRate.toFixed(1)}% of orders are fully paid — review pending payments.`);
  }

  // Refunds
  if (signals.hasRefunds) {
    const refundRate = (refundCount / total) * 100;
    insights.push(`Refund rate: ${refundRate.toFixed(1)}% (${refundCount} orders).`);
  }

  return { insights, signals };
}

function generateFulfillmentRecommendations(signals: FulfillmentSignals): string[] {
  const recs: string[] = [];

  if (signals.lowFulfillmentRate) {
    recs.push('Review the fulfillment pipeline — identify bottlenecks in the shipping process.');
    recs.push('Consider automating notifications to the logistics team for pending orders.');
  }

  if (signals.mediumFulfillmentRate) {
    recs.push('Set fulfillment SLAs (e.g., ship within 48h) and monitor compliance.');
  }

  if (signals.hasRefunds) {
    recs.push('Analyze refund reasons — they may indicate product quality issues or inaccurate descriptions.');
  }

  if (signals.hasLowPaymentRate) {
    recs.push('Set up automatic payment reminders for orders with pending charges.');
  }

  if (signals.highFulfillmentRate) {
    recs.push('Maintain current performance. Consider optimizing delivery times as a next step.');
  }

  if (recs.length === 0) {
    recs.push('Monitor these metrics weekly to detect trends early.');
  }

  return recs;
}

export async function handleGetFulfillmentMetrics(args: unknown): Promise<ToolResult> {
  try {
    const parsed = FulfillmentMetricsSchema.parse(args);
    const { period, startDate, endDate } = parsed;

    const { start, end } = getPeriodDates(period as Period, startDate, endDate);
    const queryStr = buildShopifyDateQuery(start, end);
    const { edges: orders, truncated } = await fetchAllPages(
      ORDERS_BY_DATE_RANGE,
      { query: queryStr },
      (data) => (data as OrdersQueryResult).orders
    );

    const periodLabel = formatPeriodLabel(period as Period, start, end);

    // Build breakdowns
    const fulfillmentBreakdown = buildStatusBreakdown(orders, (o) => o.displayFulfillmentStatus);
    const financialBreakdown = buildStatusBreakdown(orders, (o) => o.displayFinancialStatus);

    // Calculate totals
    const totalRevenue = orders.reduce(
      (sum, { node }) => sum + parseFloat(node.totalPriceSet.shopMoney.amount),
      0
    );
    const currency = orders.length > 0 ? orders[0].node.totalPriceSet.shopMoney.currencyCode : 'USD';
    const avgOrderValue = orders.length > 0 ? totalRevenue / orders.length : 0;

    let text = `📦 OPERATIONAL METRICS - ${periodLabel.toUpperCase()}\n`;
    text += `${formatNumber(orders.length)} orders | ${formatCurrency(totalRevenue, currency)} revenue | AOV: ${formatCurrency(avgOrderValue, currency)}\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Fulfillment breakdown
    text += `📤 FULFILLMENT STATUS:\n`;
    for (const s of fulfillmentBreakdown) {
      const label = fulfillmentLabels[s.status] || s.status;
      const bar = '█'.repeat(Math.max(1, Math.round(s.percentage / 5)));
      text += `  ${bar} ${label}: ${formatNumber(s.count)} (${s.percentage.toFixed(1)}%) — ${formatCurrency(s.revenue, currency)}\n`;
    }

    // Financial breakdown
    text += `\n💳 FINANCIAL STATUS:\n`;
    for (const s of financialBreakdown) {
      const label = financialLabels[s.status] || s.status;
      const bar = '█'.repeat(Math.max(1, Math.round(s.percentage / 5)));
      text += `  ${bar} ${label}: ${formatNumber(s.count)} (${s.percentage.toFixed(1)}%) — ${formatCurrency(s.revenue, currency)}\n`;
    }

    // Operational health score
    const fulfilledEntry = fulfillmentBreakdown.find((s) => s.status === 'FULFILLED');
    const fulfillmentRate = orders.length > 0 && fulfilledEntry ? (fulfilledEntry.count / orders.length) * 100 : 0;
    const paidEntry = financialBreakdown.find((s) => s.status === 'PAID');
    const paidRate = orders.length > 0 && paidEntry ? (paidEntry.count / orders.length) * 100 : 0;
    const healthScore = (fulfillmentRate * 0.6 + paidRate * 0.4);

    text += `\n🏥 OPERATIONAL HEALTH:\n`;
    text += `  • Fulfillment rate: ${formatPercentage(fulfillmentRate).replace('+', '')}\n`;
    text += `  • Payment rate: ${formatPercentage(paidRate).replace('+', '')}\n`;
    text += `  • Overall score: ${healthScore.toFixed(0)}/100 ${healthScore >= 80 ? '🟢' : healthScore >= 60 ? '🟡' : '🔴'}\n`;

    // Insights
    const { insights, signals } = generateFulfillmentInsights(orders, fulfillmentBreakdown, financialBreakdown);
    text += `\n💡 INSIGHTS:\n`;
    for (const insight of insights) {
      text += `• ${insight}\n`;
    }

    // Recommendations
    const recs = generateFulfillmentRecommendations(signals);
    text += `\n📋 RECOMMENDATIONS:\n`;
    for (const rec of recs) {
      text += `• ${rec}\n`;
    }

    if (truncated) {
      text += '\n⚠️ Results limited to configured maximum records. Store may have more data. Increase SHOPIFY_MAX_RECORDS to fetch more.\n';
    }

    return { content: [{ type: 'text', text }] };
  } catch (error) {
    return handleToolError(error);
  }
}
