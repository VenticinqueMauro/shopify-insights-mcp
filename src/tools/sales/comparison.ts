import { z } from 'zod';
import { fetchAllPages } from '../../shopify/client.js';
import { ORDERS_BY_DATE_RANGE } from '../../shopify/queries/orders.js';
import { buildShopifyDateQuery } from '../../utils/dates.js';
import { formatCurrency, formatPercentage, formatNumber, formatCurrencyChange } from '../../utils/formatting.js';
import { handleToolError } from '../../utils/errors.js';
import { calculateChange } from '../../analytics/comparisons.js';
import type { OrdersQueryResult, ShopifyOrder } from '../../types/shopify.js';

// Tool definition
export const salesComparisonTool = {
  name: 'get_sales_comparison',
  description: 'Compare sales metrics between two explicit date ranges side by side.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      period1Start: { type: 'string', format: 'date', description: 'Start date for period 1' },
      period1End: { type: 'string', format: 'date', description: 'End date for period 1' },
      period2Start: { type: 'string', format: 'date', description: 'Start date for period 2' },
      period2End: { type: 'string', format: 'date', description: 'End date for period 2' },
      period1Label: { type: 'string', description: 'Label for period 1 (default: "Period 1")' },
      period2Label: { type: 'string', description: 'Label for period 2 (default: "Period 2")' },
    },
    required: ['period1Start', 'period1End', 'period2Start', 'period2End'],
  },
};

// Zod schema
const SalesComparisonSchema = z.object({
  period1Start: z.string(),
  period1End: z.string(),
  period2Start: z.string(),
  period2End: z.string(),
  period1Label: z.string().default('Period 1'),
  period2Label: z.string().default('Period 2'),
});

interface PeriodMetrics {
  revenue: number;
  orders: number;
  averageOrderValue: number;
  itemsSold: number;
  currency: string;
}

function calculateMetrics(orders: ShopifyOrder[]): PeriodMetrics {
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

async function fetchOrders(startStr: string, endStr: string): Promise<{ orders: ShopifyOrder[]; truncated: boolean }> {
  const start = new Date(`${startStr}T00:00:00.000Z`);
  const end = new Date(`${endStr}T23:59:59.999Z`);
  const queryStr = buildShopifyDateQuery(start, end);
  const { edges, truncated } = await fetchAllPages(
    ORDERS_BY_DATE_RANGE,
    { query: queryStr },
    (data) => (data as OrdersQueryResult).orders
  );
  return { orders: edges, truncated };
}

export async function handleGetSalesComparison(args: unknown): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  try {
    const parsed = SalesComparisonSchema.parse(args);
    const { period1Start, period1End, period2Start, period2End, period1Label, period2Label } = parsed;

    // Fetch both periods in parallel
    const [p1Result, p2Result] = await Promise.all([
      fetchOrders(period1Start, period1End),
      fetchOrders(period2Start, period2End),
    ]);

    const p1 = calculateMetrics(p1Result.orders);
    const p2 = calculateMetrics(p2Result.orders);
    const anyTruncated = p1Result.truncated || p2Result.truncated;
    const currency = p1.currency;

    const revenueChange = calculateChange(p2.revenue, p1.revenue);
    const ordersChange = calculateChange(p2.orders, p1.orders);
    const aovChange = calculateChange(p2.averageOrderValue, p1.averageOrderValue);
    const itemsChange = calculateChange(p2.itemsSold, p1.itemsSold);

    const col1 = period1Label;
    const col2 = period2Label;
    const changeLabel = 'Change';

    // Build comparison table
    let text = `📊 SALES COMPARISON\n`;
    text += `${col1}: ${period1Start} → ${period1End}\n`;
    text += `${col2}: ${period2Start} → ${period2End}\n\n`;

    const sep = '─'.repeat(60);
    text += `${sep}\n`;

    const row = (
      label: string,
      v1: string,
      v2: string,
      change: string
    ) => `${label.padEnd(22)} ${v1.padStart(14)} ${v2.padStart(14)} ${change.padStart(10)}\n`;

    text += row('METRIC', col1.slice(0, 14), col2.slice(0, 14), changeLabel);
    text += `${sep}\n`;
    text += row('Revenue', formatCurrency(p1.revenue, currency), formatCurrency(p2.revenue, currency), formatPercentage(revenueChange.percentage));
    text += row('Orders', formatNumber(p1.orders), formatNumber(p2.orders), formatPercentage(ordersChange.percentage));
    text += row('Avg order value', formatCurrency(p1.averageOrderValue, currency), formatCurrency(p2.averageOrderValue, currency), formatPercentage(aovChange.percentage));
    text += row('Units sold', formatNumber(p1.itemsSold), formatNumber(p2.itemsSold), formatPercentage(itemsChange.percentage));
    text += `${sep}\n`;

    text += `\n📈 ANALYSIS:\n`;

    if (revenueChange.direction === 'up') {
      text += `• Revenue in ${col2} was ${formatPercentage(revenueChange.percentage)} higher (${formatCurrencyChange(revenueChange.value, currency)}).\n`;
    } else if (revenueChange.direction === 'down') {
      text += `• Revenue in ${col2} was ${formatPercentage(revenueChange.percentage)} lower (${formatCurrencyChange(revenueChange.value, currency)}).\n`;
    } else {
      text += `• Revenue remained stable between both periods.\n`;
    }

    if (ordersChange.direction !== 'flat') {
      const dir = ordersChange.direction === 'up' ? 'more' : 'fewer';
      text += `• ${formatNumber(Math.abs(ordersChange.value))} ${dir} orders processed in ${col2}.\n`;
    }

    if (aovChange.direction === 'up') {
      text += `• Average order value grew ${formatPercentage(aovChange.percentage)} — customers spent more per order.\n`;
    } else if (aovChange.direction === 'down') {
      text += `• Average order value dropped ${formatPercentage(Math.abs(aovChange.percentage))} — consider upselling strategies.\n`;
    }

    if (anyTruncated) {
      text += '\n⚠️ Results limited to configured maximum records. Store may have more data. Increase SHOPIFY_MAX_RECORDS to fetch more.\n';
    }

    return {
      content: [{ type: 'text', text }],
    };
  } catch (error) {
    return handleToolError(error);
  }
}
