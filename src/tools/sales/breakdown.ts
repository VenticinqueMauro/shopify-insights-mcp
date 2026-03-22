import { z } from 'zod';
import { fetchAllPages } from '../../shopify/client.js';
import { ORDERS_BY_DATE_RANGE } from '../../shopify/queries/orders.js';
import {
  getPeriodDates,
  buildShopifyDateQuery,
  formatPeriodLabel,
} from '../../utils/dates.js';
import { formatCurrency, formatPercentage, formatNumber } from '../../utils/formatting.js';
import { handleToolError } from '../../utils/errors.js';
import type { OrdersQueryResult } from '../../types/shopify.js';

// Tool definition
export const revenueBreakdownTool = {
  name: 'get_revenue_breakdown',
  description: 'Break down revenue by product, vendor, or product type for a given period.',
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
      dimension: {
        type: 'string',
        enum: ['product', 'vendor', 'product_type'],
        description: 'Dimension to group by (default: product)',
        default: 'product',
      },
      limit: {
        type: 'number',
        description: 'Number of top results to show (default: 10)',
        default: 10,
      },
    },
    required: ['period'],
  },
};

// Zod schema
const RevenueBreakdownSchema = z.object({
  period: z.enum(['today', 'yesterday', 'week', 'month', 'custom']),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  dimension: z.enum(['product', 'vendor', 'product_type']).default('product'),
  limit: z.number().int().min(1).max(100).default(10),
});

interface BreakdownEntry {
  key: string;
  revenue: number;
  units: number;
  orders: Set<string>;
}

type Dimension = 'product' | 'vendor' | 'product_type';

function getDimensionKey(
  product: { id: string; title: string; vendor: string; productType: string } | null,
  dimension: Dimension
): string {
  if (!product) return '(No product)';
  switch (dimension) {
    case 'product': return product.title;
    case 'vendor': return product.vendor || '(No vendor)';
    case 'product_type': return product.productType || '(No type)';
  }
}

function getDimensionLabel(dimension: Dimension): string {
  switch (dimension) {
    case 'product': return 'Product';
    case 'vendor': return 'Vendor';
    case 'product_type': return 'Product Type';
  }
}

export async function handleGetRevenueBreakdown(args: unknown): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}> {
  try {
    const parsed = RevenueBreakdownSchema.parse(args);
    const { period, startDate, endDate, dimension, limit } = parsed;

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
          text: `📊 REVENUE BREAKDOWN - ${label.toUpperCase()}\n\nNo orders found in the selected period.`,
        }],
      };
    }

    // Group by dimension
    const breakdown = new Map<string, BreakdownEntry>();
    let currency = 'USD';
    let totalRevenue = 0;

    for (const { node: order } of orders) {
      currency = order.totalPriceSet.shopMoney.currencyCode;

      for (const { node: item } of order.lineItems.edges) {
        const key = getDimensionKey(item.product, dimension);
        const lineRevenue =
          parseFloat(item.originalUnitPriceSet.shopMoney.amount) * item.quantity;

        const existing = breakdown.get(key);
        if (existing) {
          existing.revenue += lineRevenue;
          existing.units += item.quantity;
          existing.orders.add(order.id);
        } else {
          breakdown.set(key, {
            key,
            revenue: lineRevenue,
            units: item.quantity,
            orders: new Set([order.id]),
          });
        }

        totalRevenue += lineRevenue;
      }
    }

    // Sort by revenue descending and take top N
    const sorted = Array.from(breakdown.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);

    const periodLabel = formatPeriodLabel(period, start, end);
    const dimLabel = getDimensionLabel(dimension);

    let text = `📊 REVENUE BREAKDOWN BY ${dimLabel.toUpperCase()} - ${periodLabel.toUpperCase()}\n\n`;
    text += `Period total: ${formatCurrency(totalRevenue, currency)}\n`;
    text += `Total orders: ${formatNumber(orders.length)}\n`;
    text += `Showing top ${Math.min(limit, sorted.length)} of ${breakdown.size} ${dimLabel.toLowerCase()}s\n\n`;

    const sep = '─'.repeat(70);
    text += `${sep}\n`;

    const header = `${'#'.padEnd(4)}${'NAME'.padEnd(30)}${'REVENUE'.padStart(14)}${'% OF TOTAL'.padStart(12)}${'UNITS'.padStart(10)}\n`;
    text += header;
    text += `${sep}\n`;

    sorted.forEach((entry, idx) => {
      const pct = totalRevenue > 0 ? (entry.revenue / totalRevenue) * 100 : 0;
      const rank = `${idx + 1}.`.padEnd(4);
      const name = entry.key.slice(0, 29).padEnd(30);
      const rev = formatCurrency(entry.revenue, currency).padStart(14);
      const pctStr = `${pct.toFixed(1)}%`.padStart(12);
      const units = formatNumber(entry.units).padStart(10);
      text += `${rank}${name}${rev}${pctStr}${units}\n`;
    });

    text += `${sep}\n`;

    // Show "others" if there are more entries
    if (breakdown.size > limit) {
      const othersRevenue = Array.from(breakdown.values())
        .sort((a, b) => b.revenue - a.revenue)
        .slice(limit)
        .reduce((sum, e) => sum + e.revenue, 0);

      const othersPct = totalRevenue > 0 ? (othersRevenue / totalRevenue) * 100 : 0;
      text += `${''.padEnd(4)}${'Others...'.padEnd(30)}${formatCurrency(othersRevenue, currency).padStart(14)}${`${othersPct.toFixed(1)}%`.padStart(12)}\n`;
      text += `${sep}\n`;
    }

    // Add summary insight
    if (sorted.length > 0) {
      const top = sorted[0];
      const topPct = totalRevenue > 0 ? (top.revenue / totalRevenue) * 100 : 0;
      text += `\n💡 Top 1 "${top.key}" accounts for ${topPct.toFixed(1)}% of total revenue (${formatCurrency(top.revenue, currency)}).\n`;

      if (sorted.length >= 3) {
        const top3Revenue = sorted.slice(0, 3).reduce((s, e) => s + e.revenue, 0);
        const top3Pct = totalRevenue > 0 ? (top3Revenue / totalRevenue) * 100 : 0;
        text += `💡 Top 3 ${dimLabel.toLowerCase()}s account for ${top3Pct.toFixed(1)}% of total revenue.\n`;
      }
    }

    if (truncated) {
      text += '\n⚠️ Results limited to configured maximum records. Store may have more data. Increase SHOPIFY_MAX_RECORDS to fetch more.\n';
    }

    return {
      content: [{ type: 'text', text }],
    };
  } catch (error) {
    return handleToolError(error);
  }
}
