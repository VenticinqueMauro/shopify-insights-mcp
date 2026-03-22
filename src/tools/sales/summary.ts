import { z } from 'zod';
import { fetchAllPages } from '../../shopify/client.js';
import { ORDERS_BY_DATE_RANGE } from '../../shopify/queries/orders.js';
import {
  getPeriodDates,
  getPreviousPeriodDates,
  buildShopifyDateQuery,
  formatPeriodLabel,
  formatPreviousPeriodLabel,
} from '../../utils/dates.js';
import { formatCurrency, formatPercentage, formatNumber, formatCurrencyChange } from '../../utils/formatting.js';
import { handleToolError } from '../../utils/errors.js';
import { calculateChange } from '../../analytics/comparisons.js';
import { generateSalesInsights, type SalesMetrics } from '../../analytics/insights.js';
import { generateSalesRecommendations } from '../../analytics/recommendations.js';
import type { OrdersQueryResult, ShopifyOrder } from '../../types/shopify.js';

// Tool definition
export const salesSummaryTool = {
  name: 'get_sales_summary',
  description: 'Get a sales summary with revenue, orders, and AOV. Optionally compare with previous period.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      period: {
        type: 'string',
        enum: ['today', 'yesterday', 'week', 'month', 'custom'],
        description: 'Time period',
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
      compareWithPrevious: {
        type: 'boolean',
        description: 'Compare with previous period',
        default: true,
      },
    },
    required: ['period'],
  },
};

// Zod schema for validation
const SalesSummarySchema = z.object({
  period: z.enum(['today', 'yesterday', 'week', 'month', 'custom']),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  compareWithPrevious: z.boolean().default(true),
});

function calculateMetrics(orders: ShopifyOrder[]): SalesMetrics & { currency: string } {
  let revenue = 0;
  let itemsSold = 0;
  let currency = 'USD';

  for (const { node: order } of orders) {
    revenue += parseFloat(order.totalPriceSet.shopMoney.amount);
    currency = order.totalPriceSet.shopMoney.currencyCode;
    for (const { node: item } of order.lineItems.edges) {
      itemsSold += item.quantity;
    }
  }

  const orderCount = orders.length;
  const averageOrderValue = orderCount > 0 ? revenue / orderCount : 0;

  return { revenue, orders: orderCount, averageOrderValue, itemsSold, currency };
}

async function fetchOrdersForDateRange(start: Date, end: Date): Promise<{ orders: ShopifyOrder[]; truncated: boolean }> {
  const queryStr = buildShopifyDateQuery(start, end);
  const { edges, truncated } = await fetchAllPages(
    ORDERS_BY_DATE_RANGE,
    { query: queryStr },
    (data) => (data as OrdersQueryResult).orders
  );
  return { orders: edges, truncated };
}

export async function handleGetSalesSummary(args: unknown): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  try {
    const parsed = SalesSummarySchema.parse(args);
    const { period, startDate, endDate, compareWithPrevious } = parsed;

    // Get current period dates
    const { start: currentStart, end: currentEnd } = getPeriodDates(period, startDate, endDate);

    // Fetch current period orders
    const { orders: currentOrders, truncated: currentTruncated } = await fetchOrdersForDateRange(currentStart, currentEnd);
    let anyTruncated = currentTruncated;
    const currentMetrics = calculateMetrics(currentOrders);
    const currency = currentMetrics.currency;

    // Build period labels
    const currentLabel = formatPeriodLabel(period, currentStart, currentEnd);

    let responseText = `📊 SALES SUMMARY - ${currentLabel.toUpperCase()}\n\n`;
    responseText += `CURRENT METRICS:\n`;
    responseText += `• Revenue: ${formatCurrency(currentMetrics.revenue, currency)}\n`;
    responseText += `• Orders: ${formatNumber(currentMetrics.orders)}\n`;
    responseText += `• Average order value: ${formatCurrency(currentMetrics.averageOrderValue, currency)}\n`;
    responseText += `• Units sold: ${formatNumber(currentMetrics.itemsSold)}\n`;

    let previousMetrics: SalesMetrics | undefined;

    if (compareWithPrevious) {
      const { start: prevStart, end: prevEnd } = getPreviousPeriodDates(currentStart, currentEnd);
      const { orders: previousOrders, truncated: prevTruncated } = await fetchOrdersForDateRange(prevStart, prevEnd);
      if (prevTruncated) anyTruncated = true;
      previousMetrics = calculateMetrics(previousOrders);

      const prevLabel = formatPreviousPeriodLabel(period, prevStart, prevEnd);

      const revenueChange = calculateChange(currentMetrics.revenue, previousMetrics.revenue);
      const ordersChange = calculateChange(currentMetrics.orders, previousMetrics.orders);
      const aovChange = calculateChange(currentMetrics.averageOrderValue, previousMetrics.averageOrderValue);

      responseText += `\nVS. ${prevLabel.toUpperCase()}:\n`;
      responseText += `• Revenue: ${formatPercentage(revenueChange.percentage)} (${formatCurrencyChange(revenueChange.value, currency)})\n`;
      responseText += `• Orders: ${formatPercentage(ordersChange.percentage)} (${ordersChange.value >= 0 ? '+' : ''}${Math.round(ordersChange.value)})\n`;
      responseText += `• Average order value: ${formatPercentage(aovChange.percentage)} (${formatCurrencyChange(aovChange.value, currency)})\n`;
    }

    // Generate insights
    const { insights, signals } = generateSalesInsights(
      { revenue: currentMetrics.revenue, orders: currentMetrics.orders, averageOrderValue: currentMetrics.averageOrderValue, itemsSold: currentMetrics.itemsSold },
      previousMetrics
    );

    responseText += `\n💡 INSIGHTS:\n`;
    for (const insight of insights) {
      responseText += `• ${insight}\n`;
    }

    // Generate recommendations
    const recommendations = generateSalesRecommendations(signals);
    responseText += `\n📋 RECOMMENDATIONS:\n`;
    for (const rec of recommendations) {
      responseText += `• ${rec}\n`;
    }

    if (anyTruncated) {
      responseText += '\n⚠️ Results limited to configured maximum records. Store may have more data. Increase SHOPIFY_MAX_RECORDS to fetch more.\n';
    }

    return {
      content: [{ type: 'text', text: responseText }],
    };
  } catch (error) {
    return handleToolError(error);
  }
}
