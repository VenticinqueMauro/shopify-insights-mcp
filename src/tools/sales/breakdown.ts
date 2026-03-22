import { z } from 'zod';
import { shopifyQuery } from '../../shopify/client.js';
import { ORDERS_BY_DATE_RANGE } from '../../shopify/queries/orders.js';
import {
  getPeriodDates,
  buildShopifyDateQuery,
  formatPeriodLabel,
} from '../../utils/dates.js';
import { formatCurrency, formatPercentage, formatNumber } from '../../utils/formatting.js';
import { handleToolError } from '../../utils/errors.js';

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

// Shopify types
interface ShopifyMoney {
  amount: string;
  currencyCode: string;
}

interface ShopifyLineItem {
  node: {
    quantity: number;
    originalUnitPriceSet: { shopMoney: ShopifyMoney };
    product: {
      id: string;
      title: string;
      vendor: string;
      productType: string;
    } | null;
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
  if (!product) return '(Sin producto)';
  switch (dimension) {
    case 'product': return product.title;
    case 'vendor': return product.vendor || '(Sin vendedor)';
    case 'product_type': return product.productType || '(Sin tipo)';
  }
}

function getDimensionLabel(dimension: Dimension): string {
  switch (dimension) {
    case 'product': return 'Producto';
    case 'vendor': return 'Vendedor';
    case 'product_type': return 'Tipo de Producto';
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

    const data = await shopifyQuery<OrdersQueryResult>(ORDERS_BY_DATE_RANGE, { query: queryStr });
    const orders = data.orders.edges;

    if (orders.length === 0) {
      const label = formatPeriodLabel(period, start, end);
      return {
        content: [{
          type: 'text',
          text: `📊 DESGLOSE DE REVENUE - ${label.toUpperCase()}\n\nNo se encontraron pedidos en el período seleccionado.`,
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

    let text = `📊 DESGLOSE DE REVENUE POR ${dimLabel.toUpperCase()} - ${periodLabel.toUpperCase()}\n\n`;
    text += `Total del período: ${formatCurrency(totalRevenue, currency)}\n`;
    text += `Total de pedidos: ${formatNumber(orders.length)}\n`;
    text += `Mostrando top ${Math.min(limit, sorted.length)} de ${breakdown.size} ${dimLabel.toLowerCase()}s\n\n`;

    const sep = '─'.repeat(70);
    text += `${sep}\n`;

    const header = `${'#'.padEnd(4)}${'NOMBRE'.padEnd(30)}${'REVENUE'.padStart(14)}${'% DEL TOTAL'.padStart(12)}${'UNIDADES'.padStart(10)}\n`;
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
      text += `${''.padEnd(4)}${'Otros...'.padEnd(30)}${formatCurrency(othersRevenue, currency).padStart(14)}${`${othersPct.toFixed(1)}%`.padStart(12)}\n`;
      text += `${sep}\n`;
    }

    // Add summary insight
    if (sorted.length > 0) {
      const top = sorted[0];
      const topPct = totalRevenue > 0 ? (top.revenue / totalRevenue) * 100 : 0;
      text += `\n💡 El top 1 "${top.key}" representa el ${topPct.toFixed(1)}% del revenue total (${formatCurrency(top.revenue, currency)}).\n`;

      if (sorted.length >= 3) {
        const top3Revenue = sorted.slice(0, 3).reduce((s, e) => s + e.revenue, 0);
        const top3Pct = totalRevenue > 0 ? (top3Revenue / totalRevenue) * 100 : 0;
        text += `💡 Los top 3 ${dimLabel.toLowerCase()}s concentran el ${top3Pct.toFixed(1)}% del revenue total.\n`;
      }
    }

    return {
      content: [{ type: 'text', text }],
    };
  } catch (error) {
    return handleToolError(error);
  }
}
