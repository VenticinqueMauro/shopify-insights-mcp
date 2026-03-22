import { z } from 'zod';
import { shopifyQuery } from '../../shopify/client.js';
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

    const data = await shopifyQuery<OrdersQueryResult>(ORDERS_BY_DATE_RANGE, { query: queryStr });
    const orders = data.orders.edges;

    if (orders.length === 0) {
      const label = formatPeriodLabel(period, start, end);
      return {
        content: [{
          type: 'text',
          text: `📦 RENDIMIENTO DE PRODUCTOS - ${label.toUpperCase()}\n\nNo se encontraron pedidos en el período seleccionado.`,
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
        const title = item.product?.title ?? '(Sin producto)';
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
    const sortLabel = sort_by === 'revenue' ? 'Revenue' : sort_by === 'units' ? 'Unidades' : 'Pedidos';

    let text = `📦 RENDIMIENTO DE PRODUCTOS - ${periodLabel.toUpperCase()}\n`;
    text += `Ordenado por: ${sortLabel}\n\n`;
    text += `Total del período: ${formatCurrency(totalRevenue, currency)} | ${formatNumber(orders.length)} pedidos | ${formatNumber(totalUnits)} unidades\n`;
    text += `Mostrando top ${Math.min(limit, sorted.length)} de ${products.size} productos\n\n`;

    const sep = '─'.repeat(80);
    text += `${sep}\n`;

    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      const orderCount = p.orderIds.size;
      const aov = orderCount > 0 ? p.revenue / orderCount : 0;
      const pctRevenue = totalRevenue > 0 ? (p.revenue / totalRevenue) * 100 : 0;

      text += `${i + 1}. ${p.title}\n`;
      text += `   Revenue: ${formatCurrency(p.revenue, currency)} (${pctRevenue.toFixed(1)}% del total)\n`;
      text += `   Unidades: ${formatNumber(p.units)} | Pedidos: ${formatNumber(orderCount)} | AOV: ${formatCurrency(aov, currency)}\n`;
      text += `${sep}\n`;
    }

    // Insights
    if (sorted.length > 0) {
      const top = sorted[0];
      const topPct = totalRevenue > 0 ? (top.revenue / totalRevenue) * 100 : 0;
      text += `\n💡 Top performer: "${top.title}" con ${topPct.toFixed(1)}% del revenue total.\n`;
    }

    if (sorted.length >= 3) {
      const top3Rev = sorted.slice(0, 3).reduce((s, p) => s + p.revenue, 0);
      const top3Pct = totalRevenue > 0 ? (top3Rev / totalRevenue) * 100 : 0;
      text += `💡 Los top 3 productos concentran el ${top3Pct.toFixed(1)}% del revenue.\n`;

      if (top3Pct > 80) {
        text += `⚠️ Alta concentración de revenue — considerar diversificar la oferta.\n`;
      }
    }

    return { content: [{ type: 'text', text }] };
  } catch (error) {
    return handleToolError(error);
  }
}
