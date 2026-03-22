import { z } from 'zod';
import { fetchAllPages } from '../../shopify/client.js';
import { ORDERS_BY_DATE_RANGE } from '../../shopify/queries/orders.js';
import { buildShopifyDateQuery } from '../../utils/dates.js';
import { formatCurrency, formatNumber, formatPercentage } from '../../utils/formatting.js';
import { handleToolError } from '../../utils/errors.js';
import type { OrdersQueryResult, ShopifyOrder, ToolResult } from '../../types/shopify.js';

export const trendingProductsTool = {
  name: 'get_trending_products',
  description:
    'Identify trending products by comparing sales between the current period and the previous one. Shows growth rates, rising stars, and declining products.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      period: {
        type: 'string',
        enum: ['week', 'month'],
        description: 'Period to analyze (compares current vs previous)',
        default: 'week',
      },
      limit: {
        type: 'number',
        description: 'Number of products to show (default: 10)',
        default: 10,
      },
    },
    required: [],
  },
};

const TrendingSchema = z.object({
  period: z.enum(['week', 'month']).default('week'),
  limit: z.number().int().min(1).max(50).default(10),
});

interface PeriodSales {
  revenue: number;
  units: number;
}

function getPeriodRanges(period: 'week' | 'month') {
  const now = new Date();

  if (period === 'week') {
    const currentStart = new Date(now);
    currentStart.setDate(currentStart.getDate() - 6);
    currentStart.setHours(0, 0, 0, 0);

    const currentEnd = new Date(now);
    currentEnd.setHours(23, 59, 59, 999);

    const prevStart = new Date(currentStart);
    prevStart.setDate(prevStart.getDate() - 7);

    const prevEnd = new Date(currentStart);
    prevEnd.setDate(prevEnd.getDate() - 1);
    prevEnd.setHours(23, 59, 59, 999);

    return {
      current: { start: currentStart, end: currentEnd },
      previous: { start: prevStart, end: prevEnd },
      label: 'Last 7 days vs previous week',
    };
  }

  // month
  const currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const currentEnd = new Date(now);
  currentEnd.setHours(23, 59, 59, 999);

  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  prevEnd.setHours(23, 59, 59, 999);

  return {
    current: { start: currentStart, end: currentEnd },
    previous: { start: prevStart, end: prevEnd },
    label: 'This month vs previous month',
  };
}

function aggregateByProduct(orders: ShopifyOrder[]): Map<string, PeriodSales> {
  const map = new Map<string, PeriodSales>();

  for (const { node: order } of orders) {
    for (const { node: item } of order.lineItems.edges) {
      const title = item.product?.title ?? '(No product)';
      const revenue = parseFloat(item.originalUnitPriceSet.shopMoney.amount) * item.quantity;

      const existing = map.get(title);
      if (existing) {
        existing.revenue += revenue;
        existing.units += item.quantity;
      } else {
        map.set(title, { revenue, units: item.quantity });
      }
    }
  }

  return map;
}

export async function handleGetTrendingProducts(args: unknown): Promise<ToolResult> {
  try {
    const { period, limit } = TrendingSchema.parse(args);
    const ranges = getPeriodRanges(period);

    // Fetch both periods in parallel
    const [currentResult, previousResult] = await Promise.all([
      fetchAllPages(
        ORDERS_BY_DATE_RANGE,
        { query: buildShopifyDateQuery(ranges.current.start, ranges.current.end) },
        (data) => (data as OrdersQueryResult).orders
      ),
      fetchAllPages(
        ORDERS_BY_DATE_RANGE,
        { query: buildShopifyDateQuery(ranges.previous.start, ranges.previous.end) },
        (data) => (data as OrdersQueryResult).orders
      ),
    ]);

    const anyTruncated = currentResult.truncated || previousResult.truncated;
    const currentProducts = aggregateByProduct(currentResult.edges);
    const previousProducts = aggregateByProduct(previousResult.edges);

    // Merge all product names
    const allProducts = new Set([...currentProducts.keys(), ...previousProducts.keys()]);

    // Calculate trends
    const trends: Array<{
      title: string;
      currentRevenue: number;
      previousRevenue: number;
      currentUnits: number;
      previousUnits: number;
      growthRate: number | null; // null = new product
      status: 'NEW' | 'RISING' | 'DECLINING' | 'STABLE' | 'STOPPED';
    }> = [];

    let currency = 'USD';
    if (currentResult.edges.length > 0) {
      currency = currentResult.edges[0].node.totalPriceSet.shopMoney.currencyCode;
    }

    for (const title of allProducts) {
      const curr = currentProducts.get(title) ?? { revenue: 0, units: 0 };
      const prev = previousProducts.get(title) ?? { revenue: 0, units: 0 };

      let growthRate: number | null = null;
      let status: typeof trends[0]['status'];

      if (prev.revenue === 0 && curr.revenue > 0) {
        status = 'NEW';
      } else if (curr.revenue === 0 && prev.revenue > 0) {
        growthRate = -100;
        status = 'STOPPED';
      } else if (prev.revenue > 0) {
        growthRate = ((curr.revenue - prev.revenue) / prev.revenue) * 100;
        if (growthRate > 5) status = 'RISING';
        else if (growthRate < -5) status = 'DECLINING';
        else status = 'STABLE';
      } else {
        status = 'STABLE';
      }

      trends.push({
        title,
        currentRevenue: curr.revenue,
        previousRevenue: prev.revenue,
        currentUnits: curr.units,
        previousUnits: prev.units,
        growthRate,
        status,
      });
    }

    // Sort: new products first, then by growth rate descending
    trends.sort((a, b) => {
      if (a.status === 'NEW' && b.status !== 'NEW') return -1;
      if (b.status === 'NEW' && a.status !== 'NEW') return 1;
      return (b.growthRate ?? 0) - (a.growthRate ?? 0);
    });

    const top = trends.slice(0, limit);

    let text = `📈 TRENDING PRODUCTS\n`;
    text += `${ranges.label}\n\n`;
    text += `Total products analyzed: ${allProducts.size}\n\n`;

    const sep = '─'.repeat(80);
    text += `${sep}\n`;

    for (let i = 0; i < top.length; i++) {
      const t = top[i];
      const icon =
        t.status === 'NEW' ? '🆕' :
        t.status === 'RISING' ? '🔥' :
        t.status === 'DECLINING' ? '📉' :
        t.status === 'STOPPED' ? '⛔' : '➡️';

      text += `${i + 1}. ${icon} ${t.title} [${t.status}]\n`;
      text += `   Revenue: ${formatCurrency(t.currentRevenue, currency)} (previous: ${formatCurrency(t.previousRevenue, currency)})`;

      if (t.growthRate !== null) {
        text += ` | Change: ${formatPercentage(t.growthRate)}`;
      }
      text += '\n';

      text += `   Units: ${formatNumber(t.currentUnits)} (previous: ${formatNumber(t.previousUnits)})\n`;
      text += `${sep}\n`;
    }

    // Insights
    const rising = trends.filter(t => t.status === 'RISING');
    const declining = trends.filter(t => t.status === 'DECLINING');
    const newProducts = trends.filter(t => t.status === 'NEW');
    const stopped = trends.filter(t => t.status === 'STOPPED');

    text += '\n';
    if (rising.length > 0) {
      text += `💡 ${rising.length} product(s) rising — fastest growers are candidates for increased promotion.\n`;
    }
    if (declining.length > 0) {
      text += `💡 ${declining.length} product(s) declining — review pricing, stock availability, or visibility.\n`;
    }
    if (newProducts.length > 0) {
      text += `💡 ${newProducts.length} new product(s) with no prior sales — monitor adoption.\n`;
    }
    if (stopped.length > 0) {
      text += `⚠️ ${stopped.length} product(s) stopped selling — possible stockout or listing issue.\n`;
    }

    if (anyTruncated) {
      text += '\n⚠️ Results limited to configured maximum records. Store may have more data. Increase SHOPIFY_MAX_RECORDS to fetch more.\n';
    }

    return { content: [{ type: 'text', text }] };
  } catch (error) {
    return handleToolError(error);
  }
}
