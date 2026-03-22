import { z } from 'zod';
import { fetchAllPages } from '../../shopify/client.js';
import { ORDERS_BY_DATE_RANGE } from '../../shopify/queries/orders.js';
import {
  getPeriodDates,
  buildShopifyDateQuery,
  formatPeriodLabel,
} from '../../utils/dates.js';
import { formatCurrency, formatNumber } from '../../utils/formatting.js';
import { handleToolError } from '../../utils/errors.js';
import type { OrdersQueryResult, ToolResult } from '../../types/shopify.js';

export const productPerformanceTool = {
  name: 'get_product_performance',
  description:
    'Rank products by revenue, units sold, or order count for a given period. Shows detailed per-product metrics including AOV and share of total.',
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
        description: 'Start date (only for custom period)',
      },
      endDate: {
        type: 'string',
        format: 'date',
        description: 'End date (only for custom period)',
      },
      sort_by: {
        type: 'string',
        enum: ['revenue', 'units', 'orders'],
        description: 'Metric to sort by (default: revenue)',
        default: 'revenue',
      },
      limit: {
        type: 'number',
        description: 'Number of top products to show (default: 10)',
        default: 10,
      },
    },
    required: ['period'],
  },
};

const PerformanceSchema = z.object({
  period: z.enum(['today', 'yesterday', 'week', 'month', 'custom']),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  sort_by: z.enum(['revenue', 'units', 'orders']).default('revenue'),
  limit: z.number().int().min(1).max(100).default(10),
});

interface ProductMetrics {
  title: string;
  revenue: number;
  units: number;
  orderIds: Set<string>;
}

export async function handleGetProductPerformance(args: unknown): Promise<ToolResult> {
  try {
    const parsed = PerformanceSchema.parse(args);
    const { period, startDate, endDate, sort_by, limit } = parsed;

    const { start, end } = getPeriodDates(period, startDate, endDate);
    const queryStr = buildShopifyDateQuery(start, end);

    const { edges: orders, truncated } = await fetchAllPages(
      ORDERS_BY_DATE_RANGE,
      { query: queryStr },
      (data) => (data as OrdersQueryResult).orders
    );

    if (orders.length === 0) {
      const label = formatPeriodLabel(period, start, end);
      return {
        content: [{
          type: 'text',
          text: `📦 PRODUCT PERFORMANCE - ${label.toUpperCase()}\n\nNo orders found in the selected period.`,
        }],
      };
    }

    // Aggregate by product
    const products = new Map<string, ProductMetrics>();
    let totalRevenue = 0;
    let totalUnits = 0;
    let currency = 'USD';

    for (const { node: order } of orders) {
      currency = order.totalPriceSet.shopMoney.currencyCode;

      for (const { node: item } of order.lineItems.edges) {
        const title = item.product?.title ?? '(No product)';
        const lineRevenue = parseFloat(item.originalUnitPriceSet.shopMoney.amount) * item.quantity;

        const existing = products.get(title);
        if (existing) {
          existing.revenue += lineRevenue;
          existing.units += item.quantity;
          existing.orderIds.add(order.id);
        } else {
          products.set(title, {
            title,
            revenue: lineRevenue,
            units: item.quantity,
            orderIds: new Set([order.id]),
          });
        }

        totalRevenue += lineRevenue;
        totalUnits += item.quantity;
      }
    }

    // Sort
    const sorted = Array.from(products.values()).sort((a, b) => {
      switch (sort_by) {
        case 'units': return b.units - a.units;
        case 'orders': return b.orderIds.size - a.orderIds.size;
        default: return b.revenue - a.revenue;
      }
    }).slice(0, limit);

    const periodLabel = formatPeriodLabel(period, start, end);
    const sortLabel = sort_by === 'revenue' ? 'Revenue' : sort_by === 'units' ? 'Units' : 'Orders';

    let text = `📦 PRODUCT PERFORMANCE - ${periodLabel.toUpperCase()}\n`;
    text += `Sorted by: ${sortLabel}\n\n`;
    text += `Period total: ${formatCurrency(totalRevenue, currency)} | ${formatNumber(orders.length)} orders | ${formatNumber(totalUnits)} units\n`;
    text += `Showing top ${Math.min(limit, sorted.length)} of ${products.size} products\n\n`;

    const sep = '─'.repeat(80);
    text += `${sep}\n`;

    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      const orderCount = p.orderIds.size;
      const aov = orderCount > 0 ? p.revenue / orderCount : 0;
      const pctRevenue = totalRevenue > 0 ? (p.revenue / totalRevenue) * 100 : 0;

      text += `${i + 1}. ${p.title}\n`;
      text += `   Revenue: ${formatCurrency(p.revenue, currency)} (${pctRevenue.toFixed(1)}% of total)\n`;
      text += `   Units: ${formatNumber(p.units)} | Orders: ${formatNumber(orderCount)} | AOV: ${formatCurrency(aov, currency)}\n`;
      text += `${sep}\n`;
    }

    // Insights
    if (sorted.length > 0) {
      const top = sorted[0];
      const topPct = totalRevenue > 0 ? (top.revenue / totalRevenue) * 100 : 0;
      text += `\n💡 Top performer: "${top.title}" with ${topPct.toFixed(1)}% of total revenue.\n`;
    }

    if (sorted.length >= 3) {
      const top3Rev = sorted.slice(0, 3).reduce((s, p) => s + p.revenue, 0);
      const top3Pct = totalRevenue > 0 ? (top3Rev / totalRevenue) * 100 : 0;
      text += `💡 Top 3 products account for ${top3Pct.toFixed(1)}% of revenue.\n`;

      if (top3Pct > 80) {
        text += `⚠️ High revenue concentration — consider diversifying your product offering.\n`;
      }
    }

    if (truncated) {
      text += '\n⚠️ Results limited to configured maximum records. Store may have more data. Increase SHOPIFY_MAX_RECORDS to fetch more.\n';
    }

    return { content: [{ type: 'text', text }] };
  } catch (error) {
    return handleToolError(error);
  }
}
