import { z } from 'zod';
import { fetchAllPages } from '../../shopify/client.js';
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
        reason: `Sin enviar hace ${days} días`,
      });
    }

    // Financial issues
    if (problematicFinancial.includes(financial)) {
      const labels: Record<string, string> = {
        REFUNDED: 'Reembolsado',
        PARTIALLY_REFUNDED: 'Reembolso parcial',
        VOIDED: 'Anulado',
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
        reason: `Pedido de alto valor (${formatCurrency(amount, currency)}) pendiente`,
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
    insights.push('Todo en orden — no se detectaron pedidos que requieran atención inmediata.');
    return insights;
  }

  if (delayed.length > 0) {
    const maxDays = Math.max(...delayed.map((o) => o.daysPending));
    insights.push(
      `${delayed.length} pedido(s) sin enviar. El más antiguo lleva ${maxDays} días pendiente.`
    );
  }

  if (financial.length > 0) {
    const totalRefunded = financial.reduce((sum, o) => sum + o.amount, 0);
    const currency = financial[0].currency;
    insights.push(
      `${financial.length} pedido(s) con problemas financieros por un total de ${formatCurrency(totalRefunded, currency)}.`
    );
  }

  if (highValue.length > 0) {
    insights.push(
      `${highValue.length} pedido(s) de alto valor esperando fulfillment — priorizar envío.`
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
      'Revisa el proceso de fulfillment — hay un patrón de retrasos que puede afectar la satisfacción del cliente.'
    );
  }
  if (delayed.length > 0) {
    recs.push('Contacta al equipo de logística para agilizar los envíos pendientes.');
  }

  if (financial.length > 0) {
    recs.push(
      'Investiga la causa de los reembolsos/anulaciones — pueden indicar problemas con productos o expectativas del cliente.'
    );
  }

  if (highValue.length > 0) {
    recs.push(
      'Prioriza el envío de pedidos de alto valor para mejorar la experiencia de clientes VIP.'
    );
  }

  if (recs.length === 0) {
    recs.push('Mantén el ritmo actual de fulfillment — los tiempos de entrega están dentro de lo esperado.');
  }

  return recs;
}

export async function handleGetOrderAlerts(args: unknown): Promise<ToolResult> {
  try {
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

    let text = `🚨 ALERTAS DE PEDIDOS - Últimos ${lookbackDays} días\n`;
    text += `${formatNumber(orders.length)} pedidos analizados | ${formatNumber(totalAlerts)} alerta(s) detectada(s)\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Delayed fulfillment
    text += `⏳ ENVÍOS DEMORADOS (>${pendingDaysThreshold} días sin enviar): ${delayedFulfillment.length}\n`;
    if (delayedFulfillment.length > 0) {
      for (const o of delayedFulfillment.slice(0, 10)) {
        text += `  • ${o.name} — ${formatCurrency(o.amount, o.currency)} — ${o.daysPending} días pendiente\n`;
      }
      if (delayedFulfillment.length > 10) {
        text += `  ... y ${delayedFulfillment.length - 10} más\n`;
      }
    } else {
      text += `  ✅ Sin retrasos\n`;
    }

    // Financial issues
    text += `\n💸 PROBLEMAS FINANCIEROS: ${financialIssues.length}\n`;
    if (financialIssues.length > 0) {
      for (const o of financialIssues.slice(0, 10)) {
        text += `  • ${o.name} — ${formatCurrency(o.amount, o.currency)} — ${o.reason}\n`;
      }
      if (financialIssues.length > 10) {
        text += `  ... y ${financialIssues.length - 10} más\n`;
      }
    } else {
      text += `  ✅ Sin problemas financieros\n`;
    }

    // High-value pending
    text += `\n💎 PEDIDOS DE ALTO VALOR PENDIENTES (>${formatCurrency(highValueThreshold, 'ARS')}): ${highValuePending.length}\n`;
    if (highValuePending.length > 0) {
      for (const o of highValuePending.slice(0, 10)) {
        text += `  • ${o.name} — ${formatCurrency(o.amount, o.currency)} — ${o.daysPending} días pendiente\n`;
      }
    } else {
      text += `  ✅ Sin pedidos de alto valor pendientes\n`;
    }

    // Insights
    const insights = generateOrderInsights(delayedFulfillment, financialIssues, highValuePending);
    text += `\n💡 INSIGHTS:\n`;
    for (const insight of insights) {
      text += `• ${insight}\n`;
    }

    // Recommendations
    const recs = generateOrderRecommendations(delayedFulfillment, financialIssues, highValuePending);
    text += `\n📋 RECOMENDACIONES:\n`;
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
