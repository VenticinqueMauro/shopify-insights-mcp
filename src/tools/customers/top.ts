import { z } from 'zod';
import { shopifyQuery } from '../../shopify/client.js';
import { CUSTOMERS_QUERY } from '../../shopify/queries/customers.js';
import { formatCurrency, formatNumber } from '../../utils/formatting.js';
import { handleToolError } from '../../utils/errors.js';
import type { CustomersQueryResult, ToolResult } from '../../types/shopify.js';

export const topCustomersTool = {
  name: 'get_top_customers',
  description:
    'Rank customers by total spend or order count. Identifies VIP customers and spending patterns.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      sort_by: {
        type: 'string',
        enum: ['total_spent', 'orders_count'],
        description: 'Metric to rank by (default: total_spent)',
        default: 'total_spent',
      },
      limit: {
        type: 'number',
        description: 'Number of top customers to show (default: 10)',
        default: 10,
      },
    },
    required: [],
  },
};

const TopCustomersSchema = z.object({
  sort_by: z.enum(['total_spent', 'orders_count']).default('total_spent'),
  limit: z.number().int().min(1).max(100).default(10),
});

export async function handleGetTopCustomers(args: unknown): Promise<ToolResult> {
  try {
    const { sort_by, limit } = TopCustomersSchema.parse(args);

    const data = await shopifyQuery<CustomersQueryResult>(CUSTOMERS_QUERY);
    const customers = data.customers.edges;

    if (customers.length === 0) {
      return {
        content: [{ type: 'text', text: '👥 TOP CLIENTES\n\nNo se encontraron clientes.' }],
      };
    }

    // Parse and enrich
    const parsed = customers.map(({ node: c }) => {
      const totalSpent = parseFloat(c.amountSpent.amount);
      const ordersCount = typeof c.numberOfOrders === 'string' ? parseInt(c.numberOfOrders, 10) : (c.numberOfOrders as unknown as number);
      const aov = ordersCount > 0 ? totalSpent / ordersCount : 0;

      return {
        name: `${c.firstName} ${c.lastName}`.trim() || c.email,
        email: c.email,
        totalSpent,
        ordersCount,
        aov,
        currency: c.amountSpent.currencyCode,
      };
    });

    // Sort
    parsed.sort((a, b) => {
      if (sort_by === 'orders_count') return b.ordersCount - a.ordersCount;
      return b.totalSpent - a.totalSpent;
    });

    const top = parsed.slice(0, limit);
    const currency = top[0]?.currency ?? 'USD';
    const totalRevenueAll = parsed.reduce((s, c) => s + c.totalSpent, 0);
    const sortLabel = sort_by === 'total_spent' ? 'Gasto total' : 'Cantidad de pedidos';

    let text = `👥 TOP CLIENTES\n`;
    text += `Ordenado por: ${sortLabel}\n`;
    text += `Total de clientes: ${formatNumber(customers.length)}\n\n`;

    const sep = '─'.repeat(70);
    text += `${sep}\n`;

    for (let i = 0; i < top.length; i++) {
      const c = top[i];
      const pctRevenue = totalRevenueAll > 0 ? (c.totalSpent / totalRevenueAll) * 100 : 0;

      text += `${i + 1}. ${c.name}\n`;
      text += `   Email: ${c.email}\n`;
      text += `   Gasto total: ${formatCurrency(c.totalSpent, currency)} (${pctRevenue.toFixed(1)}% del total)\n`;
      text += `   Pedidos: ${formatNumber(c.ordersCount)} | AOV: ${formatCurrency(c.aov, currency)}\n`;
      text += `${sep}\n`;
    }

    // Insights
    if (top.length > 0) {
      const vip = top[0];
      const vipPct = totalRevenueAll > 0 ? (vip.totalSpent / totalRevenueAll) * 100 : 0;
      text += `\n💡 Cliente #1 "${vip.name}" representa el ${vipPct.toFixed(1)}% del revenue total.\n`;

      const avgOrders = parsed.reduce((s, c) => s + c.ordersCount, 0) / parsed.length;
      text += `💡 Promedio de pedidos por cliente: ${avgOrders.toFixed(1)}\n`;

      const highFreq = parsed.filter(c => c.ordersCount >= avgOrders * 2);
      if (highFreq.length > 0) {
        text += `💡 ${highFreq.length} cliente(s) con frecuencia de compra 2x por encima del promedio.\n`;
      }
    }

    return { content: [{ type: 'text', text }] };
  } catch (error) {
    return handleToolError(error);
  }
}
