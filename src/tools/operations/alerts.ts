import { z } from 'zod';
import { fetchAllPages } from '../../shopify/client.js';
import { getShopContext } from '../../shopify/shop.js';
import { ORDERS_BY_DATE_RANGE } from '../../shopify/queries/orders.js';
import { buildShopifyDateQuery } from '../../utils/dates.js';
import { formatCurrency, formatNumber } from '../../utils/formatting.js';
import { handleToolError } from '../../utils/errors.js';
import type { ShopifyOrder, OrdersQueryResult, ToolResult } from '../../types/shopify.js';

// Tool definition
export const orderAlertsTool = {
  name: 'get_order_alerts',
  description:
    'Identify orders that require immediate attention: unfulfilled orders older than N days, financially problematic orders (refunded, voided), and high-value pending orders.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      pendingDaysThreshold: {
        type: 'number',
        description: 'Days since order was placed to flag as delayed (default: 3)',
        default: 3,
      },
      highValueThreshold: {
        type: 'number',
        description: 'Minimum order amount to flag as high-value pending (default: 50000)',
        default: 50000,
      },
      lookbackDays: {
        type: 'number',
        description: 'How many days back to look for orders (default: 30)',
        default: 30,
      },
    },
  },
};

const OrderAlertsSchema = z.object({
  pendingDaysThreshold: z.number().default(3),
  highValueThreshold: z.number().default(50000),
  lookbackDays: z.number().default(30),
});

interface OrderAlert {
  name: string;
  id: string;
  amount: number;
  currency: string;
  processedAt: string;
  daysPending: number;
  financialStatus: string;
  fulfillmentStatus: string | null;
  reason: string;
}

function daysBetween(dateStr: string, now: Date): number {
  const date = new Date(dateStr);
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function classifyOrders(
  orders: ShopifyOrder[],
  pendingDaysThreshold: number,
  highValueThreshold: number,
  now: Date
) {
  const delayedFulfillment: OrderAlert[] = [];
  const financialIssues: OrderAlert[] = [];
  const highValuePending: OrderAlert[] = [];

  const problematicFinancial = ['REFUNDED', 'PARTIALLY_REFUNDED', 'VOIDED'];

  for (const { node: order } of orders) {
    const amount = parseFloat(order.totalPriceSet.shopMoney.amount);
    const currency = order.totalPriceSet.shopMoney.currencyCode;
    const days = daysBetween(order.processedAt, now);
    const fulfillment = order.displayFulfillmentStatus;
    const financial = order.displayFinancialStatus;

    const base = {
      name: order.name,
      id: order.id,
      amount,
      currency,
      processedAt: order.processedAt,
      daysPending: days,
      financialStatus: financial,
      fulfillmentStatus: fulfillment,
    };

    // Delayed fulfillment: unfulfilled or partially fulfilled after threshold
    if (
      (fulfillment === 'UNFULFILLED' || fulfillment === null) &&
      days >= pendingDaysThreshold &&
      !problematicFinancial.includes(financial)
    ) {
      delayedFulfillment.push({
        ...base,
        reason: `Unfulfilled for ${days} day(s)`,
      });
    }

    // Financial issues
    if (problematicFinancial.includes(financial)) {
      const labels: Record<string, string> = {
        REFUNDED: 'Refunded',
        PARTIALLY_REFUNDED: 'Partially Refunded',
        VOIDED: 'Voided',
      };
      financialIssues.push({
        ...base,
        reason: labels[financial] || financial,
      });
    }

    // High-value pending
    if (
      amount >= highValueThreshold &&
      (fulfillment === 'UNFULFILLED' || fulfillment === null) &&
      !problematicFinancial.includes(financial)
    ) {
      highValuePending.push({
        ...base,
        reason: `High-value order (${formatCurrency(amount, currency)}) pending fulfillment`,
      });
    }
  }

  // Sort by priority
  delayedFulfillment.sort((a, b) => b.daysPending - a.daysPending);
  financialIssues.sort((a, b) => b.amount - a.amount);
  highValuePending.sort((a, b) => b.amount - a.amount);

  return { delayedFulfillment, financialIssues, highValuePending };
}

function generateOrderInsights(
  delayed: OrderAlert[],
  financial: OrderAlert[],
  highValue: OrderAlert[]
): string[] {
  const insights: string[] = [];
  const total = delayed.length + financial.length + highValue.length;

  if (total === 0) {
    insights.push('All clear — no orders requiring immediate attention detected.');
    return insights;
  }

  if (delayed.length > 0) {
    const maxDays = Math.max(...delayed.map((o) => o.daysPending));
    insights.push(
      `${delayed.length} order(s) awaiting fulfillment. The oldest has been pending for ${maxDays} day(s).`
    );
  }

  if (financial.length > 0) {
    const totalRefunded = financial.reduce((sum, o) => sum + o.amount, 0);
    const currency = financial[0].currency;
    insights.push(
      `${financial.length} order(s) with financial issues totaling ${formatCurrency(totalRefunded, currency)}.`
    );
  }

  if (highValue.length > 0) {
    insights.push(
      `${highValue.length} high-value order(s) awaiting fulfillment — prioritize shipping.`
    );
  }

  return insights;
}

function generateOrderRecommendations(
  delayed: OrderAlert[],
  financial: OrderAlert[],
  highValue: OrderAlert[]
): string[] {
  const recs: string[] = [];

  if (delayed.length >= 3) {
    recs.push(
      'Review the fulfillment process — a pattern of delays may affect customer satisfaction.'
    );
  }
  if (delayed.length > 0) {
    recs.push('Contact the logistics team to expedite pending shipments.');
  }

  if (financial.length > 0) {
    recs.push(
      'Investigate the cause of refunds/voids — they may indicate product issues or unmet customer expectations.'
    );
  }

  if (highValue.length > 0) {
    recs.push(
      'Prioritize shipping high-value orders to improve the experience for VIP customers.'
    );
  }

  if (recs.length === 0) {
    recs.push('Maintain the current fulfillment pace — delivery times are within expected ranges.');
  }

  return recs;
}

export async function handleGetOrderAlerts(args: unknown): Promise<ToolResult> {
  try {
    const shopContext = await getShopContext();
    const parsed = OrderAlertsSchema.parse(args);
    const { pendingDaysThreshold, highValueThreshold, lookbackDays } = parsed;

    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - lookbackDays);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);

    const queryStr = buildShopifyDateQuery(start, end);
    const { edges: orders, truncated } = await fetchAllPages(
      ORDERS_BY_DATE_RANGE,
      { query: queryStr },
      (data) => (data as OrdersQueryResult).orders
    );

    const { delayedFulfillment, financialIssues, highValuePending } = classifyOrders(
      orders,
      pendingDaysThreshold,
      highValueThreshold,
      now
    );

    const totalAlerts = delayedFulfillment.length + financialIssues.length + highValuePending.length;

    let text = `🚨 ORDER ALERTS - Last ${lookbackDays} days\n`;
    text += `${formatNumber(orders.length)} orders analyzed | ${formatNumber(totalAlerts)} alert(s) detected\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Delayed fulfillment
    text += `⏳ DELAYED FULFILLMENT (>${pendingDaysThreshold} days unfulfilled): ${delayedFulfillment.length}\n`;
    if (delayedFulfillment.length > 0) {
      for (const o of delayedFulfillment.slice(0, 10)) {
        text += `  • ${o.name} — ${formatCurrency(o.amount, o.currency)} — ${o.daysPending} day(s) pending\n`;
      }
      if (delayedFulfillment.length > 10) {
        text += `  ... and ${delayedFulfillment.length - 10} more\n`;
      }
    } else {
      text += `  ✅ No delays\n`;
    }

    // Financial issues
    text += `\n💸 FINANCIAL ISSUES: ${financialIssues.length}\n`;
    if (financialIssues.length > 0) {
      for (const o of financialIssues.slice(0, 10)) {
        text += `  • ${o.name} — ${formatCurrency(o.amount, o.currency)} — ${o.reason}\n`;
      }
      if (financialIssues.length > 10) {
        text += `  ... and ${financialIssues.length - 10} more\n`;
      }
    } else {
      text += `  ✅ No financial issues\n`;
    }

    // High-value pending
    text += `\n💎 HIGH-VALUE PENDING ORDERS (>${formatCurrency(highValueThreshold, shopContext.currencyCode)}): ${highValuePending.length}\n`;
    if (highValuePending.length > 0) {
      for (const o of highValuePending.slice(0, 10)) {
        text += `  • ${o.name} — ${formatCurrency(o.amount, o.currency)} — ${o.daysPending} day(s) pending\n`;
      }
    } else {
      text += `  ✅ No high-value pending orders\n`;
    }

    // Insights
    const insights = generateOrderInsights(delayedFulfillment, financialIssues, highValuePending);
    text += `\n💡 INSIGHTS:\n`;
    for (const insight of insights) {
      text += `• ${insight}\n`;
    }

    // Recommendations
    const recs = generateOrderRecommendations(delayedFulfillment, financialIssues, highValuePending);
    text += `\n📋 RECOMMENDATIONS:\n`;
    for (const rec of recs) {
      text += `• ${rec}\n`;
    }

    if (truncated) {
      text += '\n⚠️ Results limited to configured maximum records. Store may have more data. Increase SHOPIFY_MAX_RECORDS to fetch more.\n';
    }

    return { content: [{ type: 'text', text }] };
  } catch (error) {
    return handleToolError(error);
  }
}
