import { z } from 'zod';
import { fetchAllPages } from '../../shopify/client.js';
import { getShopContext } from '../../shopify/shop.js';
import { CUSTOMERS_QUERY } from '../../shopify/queries/customers.js';
import { ORDERS_BY_DATE_RANGE } from '../../shopify/queries/orders.js';
import {
  getPeriodDates,
  buildShopifyDateQuery,
  formatPeriodLabel,
} from '../../utils/dates.js';
import { formatCurrency, formatNumber } from '../../utils/formatting.js';
import { handleToolError } from '../../utils/errors.js';
import type { CustomersQueryResult, OrdersQueryResult, ToolResult } from '../../types/shopify.js';

export const customerSegmentsTool = {
  name: 'get_customer_segments',
  description:
    'Segment customers into VIP, Loyal, Returning, New, and Inactive based on order history and spending. Shows distribution and average spend per segment.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      period: {
        type: 'string',
        enum: ['week', 'month', 'custom'],
        description: 'Period to determine activity (default: month)',
        default: 'month',
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
    },
    required: [],
  },
};

const SegmentsSchema = z.object({
  period: z.enum(['week', 'month', 'custom']).default('month'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

type SegmentName = 'VIP' | 'Loyal' | 'Returning' | 'New' | 'Inactive';

interface SegmentData {
  name: SegmentName;
  icon: string;
  description: string;
  customers: Array<{ name: string; totalSpent: number; ordersCount: number }>;
}

export async function handleGetCustomerSegments(args: unknown): Promise<ToolResult> {
  try {
    const shopContext = await getShopContext();
    const parsed = SegmentsSchema.parse(args);
    const { period, startDate, endDate } = parsed;

    const { start, end } = getPeriodDates(period, startDate, endDate, shopContext.ianaTimezone);
    const queryStr = buildShopifyDateQuery(start, end);

    // Fetch customers and period orders in parallel
    const [customersResult, ordersResult] = await Promise.all([
      fetchAllPages(CUSTOMERS_QUERY, {}, (data) => (data as CustomersQueryResult).customers),
      fetchAllPages(ORDERS_BY_DATE_RANGE, { query: queryStr }, (data) => (data as OrdersQueryResult).orders),
    ]);

    const customers = customersResult.edges;
    const orders = ordersResult.edges;
    const anyTruncated = customersResult.truncated || ordersResult.truncated;

    if (customers.length === 0) {
      return {
        content: [{ type: 'text', text: '👥 CUSTOMER SEGMENTS\n\nNo customers found.' }],
      };
    }

    // Find which customers had orders in the period
    const activeCustomerIds = new Set<string>();
    for (const { node: order } of orders) {
      if (order.customer?.id) {
        activeCustomerIds.add(order.customer.id);
      }
    }

    // Parse customers and determine segments
    const allCustomers = customers.map(({ node: c }) => {
      const totalSpent = parseFloat(c.amountSpent.amount);
      const ordersCount = parseInt(c.numberOfOrders, 10);
      return {
        id: c.id,
        name: `${c.firstName} ${c.lastName}`.trim() || c.email,
        totalSpent,
        ordersCount,
        currency: c.amountSpent.currencyCode,
        activeInPeriod: activeCustomerIds.has(c.id),
      };
    });

    // Determine VIP threshold: top 10% by totalSpent
    const sortedBySpend = [...allCustomers].sort((a, b) => b.totalSpent - a.totalSpent);
    const vipThresholdIdx = Math.max(1, Math.ceil(allCustomers.length * 0.1));
    const vipThreshold = sortedBySpend[vipThresholdIdx - 1]?.totalSpent ?? 0;

    // Segment assignment
    const segments: Record<SegmentName, SegmentData> = {
      VIP:       { name: 'VIP', icon: '👑', description: 'Top 10% by total spend', customers: [] },
      Loyal:     { name: 'Loyal', icon: '💎', description: '4+ orders', customers: [] },
      Returning: { name: 'Returning', icon: '🔄', description: '2-3 orders', customers: [] },
      New:       { name: 'New', icon: '🌱', description: '1 order', customers: [] },
      Inactive:  { name: 'Inactive', icon: '💤', description: 'No orders in period', customers: [] },
    };

    for (const c of allCustomers) {
      const entry = { name: c.name, totalSpent: c.totalSpent, ordersCount: c.ordersCount };

      if (c.totalSpent >= vipThreshold && vipThreshold > 0) {
        segments.VIP.customers.push(entry);
      } else if (c.ordersCount >= 4) {
        segments.Loyal.customers.push(entry);
      } else if (c.ordersCount >= 2) {
        segments.Returning.customers.push(entry);
      } else if (c.ordersCount === 1) {
        segments.New.customers.push(entry);
      } else if (!c.activeInPeriod && c.ordersCount > 0) {
        segments.Inactive.customers.push(entry);
      } else if (c.ordersCount === 0) {
        // No orders at all — also inactive
        segments.Inactive.customers.push(entry);
      }
    }

    const currency = allCustomers[0]?.currency ?? shopContext.currencyCode;
    const periodLabel = formatPeriodLabel(period, start, end);
    const totalCustomers = allCustomers.length;

    let text = `👥 CUSTOMER SEGMENTS - ${periodLabel.toUpperCase()}\n\n`;
    text += `Total customers: ${formatNumber(totalCustomers)}\n`;
    text += `Active customers in period: ${formatNumber(activeCustomerIds.size)}\n\n`;

    const sep = '─'.repeat(70);
    text += `${sep}\n`;

    const segmentOrder: SegmentName[] = ['VIP', 'Loyal', 'Returning', 'New', 'Inactive'];

    for (const segName of segmentOrder) {
      const seg = segments[segName];
      const count = seg.customers.length;
      const pct = totalCustomers > 0 ? (count / totalCustomers) * 100 : 0;
      const avgSpend = count > 0
        ? seg.customers.reduce((s, c) => s + c.totalSpent, 0) / count
        : 0;

      text += `\n${seg.icon} ${seg.name} — ${seg.description}\n`;
      text += `   Customers: ${formatNumber(count)} (${pct.toFixed(1)}%)\n`;
      text += `   Avg spend: ${formatCurrency(avgSpend, currency)}\n`;

      // Show top 3 in each segment
      const topInSeg = [...seg.customers].sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 3);
      if (topInSeg.length > 0) {
        for (const c of topInSeg) {
          text += `     • ${c.name}: ${formatCurrency(c.totalSpent, currency)} (${formatNumber(c.ordersCount)} orders)\n`;
        }
      }
    }

    text += `\n${sep}\n`;

    // Insights
    const vipRevenue = segments.VIP.customers.reduce((s, c) => s + c.totalSpent, 0);
    const totalRevenue = allCustomers.reduce((s, c) => s + c.totalSpent, 0);
    const vipRevPct = totalRevenue > 0 ? (vipRevenue / totalRevenue) * 100 : 0;

    text += `\n💡 ${segments.VIP.customers.length} VIP customers generate ${vipRevPct.toFixed(1)}% of total revenue.\n`;

    if (segments.Inactive.customers.length > 0) {
      text += `💡 ${segments.Inactive.customers.length} inactive customer(s) — reactivation opportunity with targeted campaigns.\n`;
    }

    if (segments.New.customers.length > 0) {
      text += `💡 ${segments.New.customers.length} new customer(s) — key focus: drive their second purchase.\n`;
    }

    if (anyTruncated) {
      text += '\n⚠️ Results limited to configured maximum records. Store may have more data. Increase SHOPIFY_MAX_RECORDS to fetch more.\n';
    }

    return { content: [{ type: 'text', text }] };
  } catch (error) {
    return handleToolError(error);
  }
}
