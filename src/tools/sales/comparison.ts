import { z } from 'zod';
import { shopifyQuery } from '../../shopify/client.js';
import { ORDERS_BY_DATE_RANGE } from '../../shopify/queries/orders.js';
import { buildShopifyDateQuery } from '../../utils/dates.js';
import { formatCurrency, formatPercentage, formatNumber, formatCurrencyChange } from '../../utils/formatting.js';
import { handleToolError } from '../../utils/errors.js';
import { calculateChange } from '../../analytics/comparisons.js';

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
      period1Label: { type: 'string', description: 'Label for period 1 (default: "Período 1")' },
      period2Label: { type: 'string', description: 'Label for period 2 (default: "Período 2")' },
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
  period1Label: z.string().default('Período 1'),
  period2Label: z.string().default('Período 2'),
});

// Shopify types
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

async function fetchOrders(startStr: string, endStr: string): Promise<ShopifyOrder[]> {
  const start = new Date(`${startStr}T00:00:00.000Z`);
  const end = new Date(`${endStr}T23:59:59.999Z`);
  const queryStr = buildShopifyDateQuery(start, end);
  const data = await shopifyQuery<OrdersQueryResult>(ORDERS_BY_DATE_RANGE, { query: queryStr });
  return data.orders.edges;
}

export async function handleGetSalesComparison(args: unknown): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  try {
    const parsed = SalesComparisonSchema.parse(args);
    const { period1Start, period1End, period2Start, period2End, period1Label, period2Label } = parsed;

    // Fetch both periods in parallel
    const [p1Orders, p2Orders] = await Promise.all([
      fetchOrders(period1Start, period1End),
      fetchOrders(period2Start, period2End),
    ]);

    const p1 = calculateMetrics(p1Orders);
    const p2 = calculateMetrics(p2Orders);
    const currency = p1.currency;

    const revenueChange = calculateChange(p2.revenue, p1.revenue);
    const ordersChange = calculateChange(p2.orders, p1.orders);
    const aovChange = calculateChange(p2.averageOrderValue, p1.averageOrderValue);
    const itemsChange = calculateChange(p2.itemsSold, p1.itemsSold);

    const col1 = period1Label;
    const col2 = period2Label;
    const changeLabel = 'Variación';

    // Build comparison table
    let text = `📊 COMPARACIÓN DE VENTAS\n`;
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

    text += row('MÉTRICA', col1.slice(0, 14), col2.slice(0, 14), changeLabel);
    text += `${sep}\n`;
    text += row('Revenue', formatCurrency(p1.revenue, currency), formatCurrency(p2.revenue, currency), formatPercentage(revenueChange.percentage));
    text += row('Pedidos', formatNumber(p1.orders), formatNumber(p2.orders), formatPercentage(ordersChange.percentage));
    text += row('Ticket promedio', formatCurrency(p1.averageOrderValue, currency), formatCurrency(p2.averageOrderValue, currency), formatPercentage(aovChange.percentage));
    text += row('Unidades vendidas', formatNumber(p1.itemsSold), formatNumber(p2.itemsSold), formatPercentage(itemsChange.percentage));
    text += `${sep}\n`;

    text += `\n📈 ANÁLISIS:\n`;

    if (revenueChange.direction === 'up') {
      text += `• El revenue de ${col2} fue ${formatPercentage(revenueChange.percentage)} mayor (${formatCurrencyChange(revenueChange.value, currency)}).\n`;
    } else if (revenueChange.direction === 'down') {
      text += `• El revenue de ${col2} fue ${formatPercentage(revenueChange.percentage)} menor (${formatCurrencyChange(revenueChange.value, currency)}).\n`;
    } else {
      text += `• El revenue se mantuvo estable entre ambos períodos.\n`;
    }

    if (ordersChange.direction !== 'flat') {
      const dir = ordersChange.direction === 'up' ? 'más' : 'menos';
      text += `• Se procesaron ${formatNumber(Math.abs(ordersChange.value))} pedidos ${dir} en ${col2}.\n`;
    }

    if (aovChange.direction === 'up') {
      text += `• El ticket promedio creció ${formatPercentage(aovChange.percentage)} — los clientes gastaron más por pedido.\n`;
    } else if (aovChange.direction === 'down') {
      text += `• El ticket promedio bajó ${formatPercentage(Math.abs(aovChange.percentage))} — considera estrategias de upselling.\n`;
    }

    return {
      content: [{ type: 'text', text }],
    };
  } catch (error) {
    return handleToolError(error);
  }
}
