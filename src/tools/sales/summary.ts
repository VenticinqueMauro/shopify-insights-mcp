import { z } from 'zod';
import { shopifyQuery } from '../../shopify/client.js';
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

// Shopify order response types
interface ShopifyMoney {
  amount: string;
  currencyCode: string;
}

interface ShopifyLineItem {
  node: {
    quantity: number;
    originalUnitPriceSet: { shopMoney: ShopifyMoney };
    product: { id: string; title: string; vendor: string; productType: string } | null;
  };
}

interface ShopifyOrder {
  node: {
    id: string;
    name: string;
    processedAt: string;
    totalPriceSet: { shopMoney: ShopifyMoney };
    lineItems: { edges: ShopifyLineItem[] };
    financialStatus: string;
    fulfillmentStatus: string | null;
  };
}

interface OrdersQueryResult {
  orders: { edges: ShopifyOrder[] };
}

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

async function fetchOrdersForDateRange(start: Date, end: Date): Promise<ShopifyOrder[]> {
  const queryStr = buildShopifyDateQuery(start, end);
  const data = await shopifyQuery<OrdersQueryResult>(ORDERS_BY_DATE_RANGE, { query: queryStr });
  return data.orders.edges;
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
    const currentOrders = await fetchOrdersForDateRange(currentStart, currentEnd);
    const currentMetrics = calculateMetrics(currentOrders);
    const currency = currentMetrics.currency;

    // Build period labels
    const currentLabel = formatPeriodLabel(period, currentStart, currentEnd);

    let responseText = `📊 RESUMEN DE VENTAS - ${currentLabel.toUpperCase()}\n\n`;
    responseText += `MÉTRICAS ACTUALES:\n`;
    responseText += `• Revenue: ${formatCurrency(currentMetrics.revenue, currency)}\n`;
    responseText += `• Pedidos: ${formatNumber(currentMetrics.orders)}\n`;
    responseText += `• Ticket promedio: ${formatCurrency(currentMetrics.averageOrderValue, currency)}\n`;
    responseText += `• Unidades vendidas: ${formatNumber(currentMetrics.itemsSold)}\n`;

    let previousMetrics: SalesMetrics | undefined;

    if (compareWithPrevious) {
      const { start: prevStart, end: prevEnd } = getPreviousPeriodDates(currentStart, currentEnd);
      const previousOrders = await fetchOrdersForDateRange(prevStart, prevEnd);
      previousMetrics = calculateMetrics(previousOrders);

      const prevLabel = formatPreviousPeriodLabel(period, prevStart, prevEnd);

      const revenueChange = calculateChange(currentMetrics.revenue, previousMetrics.revenue);
      const ordersChange = calculateChange(currentMetrics.orders, previousMetrics.orders);
      const aovChange = calculateChange(currentMetrics.averageOrderValue, previousMetrics.averageOrderValue);

      responseText += `\nVS. ${prevLabel.toUpperCase()}:\n`;
      responseText += `• Revenue: ${formatPercentage(revenueChange.percentage)} (${formatCurrencyChange(revenueChange.value, currency)})\n`;
      responseText += `• Pedidos: ${formatPercentage(ordersChange.percentage)} (${ordersChange.value >= 0 ? '+' : ''}${Math.round(ordersChange.value)})\n`;
      responseText += `• Ticket promedio: ${formatPercentage(aovChange.percentage)} (${formatCurrencyChange(aovChange.value, currency)})\n`;
    }

    // Generate insights
    const insights = generateSalesInsights(
      { revenue: currentMetrics.revenue, orders: currentMetrics.orders, averageOrderValue: currentMetrics.averageOrderValue, itemsSold: currentMetrics.itemsSold },
      previousMetrics
    );

    responseText += `\n💡 INSIGHTS:\n`;
    for (const insight of insights) {
      responseText += `• ${insight}\n`;
    }

    // Generate recommendations
    const recommendations = generateSalesRecommendations(insights);
    responseText += `\n📋 RECOMENDACIONES:\n`;
    for (const rec of recommendations) {
      responseText += `• ${rec}\n`;
    }

    return {
      content: [{ type: 'text', text: responseText }],
    };
  } catch (error) {
    return handleToolError(error);
  }
}
