import { z } from 'zod';
import { shopifyQuery } from '../../shopify/client.js';
import { ORDERS_BY_DATE_RANGE } from '../../shopify/queries/orders.js';
import { getPeriodDates, buildShopifyDateQuery, formatPeriodLabel, type Period } from '../../utils/dates.js';
import { formatCurrency, formatPercentage, formatNumber } from '../../utils/formatting.js';
import { handleToolError } from '../../utils/errors.js';
import type { ShopifyOrder, OrdersQueryResult, ToolResult } from '../../types/shopify.js';

// Tool definition
export const fulfillmentMetricsTool = {
  name: 'get_fulfillment_metrics',
  description:
    'Get operational metrics: fulfillment status breakdown, financial status distribution, average order value by status, and operational health indicators.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      period: {
        type: 'string',
        enum: ['today', 'yesterday', 'week', 'month', 'custom'],
        description: 'Time period to analyze',
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
    },
    required: ['period'],
  },
};

const FulfillmentMetricsSchema = z.object({
  period: z.enum(['today', 'yesterday', 'week', 'month', 'custom']),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

interface StatusCount {
  status: string;
  count: number;
  revenue: number;
  percentage: number;
}

function buildStatusBreakdown(orders: ShopifyOrder[], getter: (o: ShopifyOrder['node']) => string | null): StatusCount[] {
  const map = new Map<string, { count: number; revenue: number }>();

  for (const { node: order } of orders) {
    const status = getter(order) || 'UNKNOWN';
    const existing = map.get(status) || { count: 0, revenue: 0 };
    existing.count += 1;
    existing.revenue += parseFloat(order.totalPriceSet.shopMoney.amount);
    map.set(status, existing);
  }

  const total = orders.length;
  const result: StatusCount[] = [];

  for (const [status, data] of map.entries()) {
    result.push({
      status,
      count: data.count,
      revenue: data.revenue,
      percentage: total > 0 ? (data.count / total) * 100 : 0,
    });
  }

  return result.sort((a, b) => b.count - a.count);
}

const fulfillmentLabels: Record<string, string> = {
  FULFILLED: 'Enviado',
  UNFULFILLED: 'Sin enviar',
  PARTIALLY_FULFILLED: 'Envío parcial',
  UNKNOWN: 'Sin estado',
};

const financialLabels: Record<string, string> = {
  PAID: 'Pagado',
  PENDING: 'Pago pendiente',
  REFUNDED: 'Reembolsado',
  PARTIALLY_REFUNDED: 'Reembolso parcial',
  VOIDED: 'Anulado',
  AUTHORIZED: 'Autorizado',
  PARTIALLY_PAID: 'Pago parcial',
  UNKNOWN: 'Sin estado',
};

function generateFulfillmentInsights(
  orders: ShopifyOrder[],
  fulfillmentBreakdown: StatusCount[],
  financialBreakdown: StatusCount[]
): string[] {
  const insights: string[] = [];
  const total = orders.length;

  if (total === 0) {
    insights.push('No se encontraron pedidos en el período seleccionado.');
    return insights;
  }

  // Fulfillment rate
  const fulfilled = fulfillmentBreakdown.find((s) => s.status === 'FULFILLED');
  const fulfillmentRate = fulfilled ? (fulfilled.count / total) * 100 : 0;

  if (fulfillmentRate >= 90) {
    insights.push(`Excelente tasa de fulfillment: ${fulfillmentRate.toFixed(1)}% de pedidos enviados.`);
  } else if (fulfillmentRate >= 70) {
    insights.push(`Tasa de fulfillment aceptable: ${fulfillmentRate.toFixed(1)}%. Hay margen de mejora.`);
  } else {
    insights.push(`Tasa de fulfillment baja: ${fulfillmentRate.toFixed(1)}%. Requiere atención urgente.`);
  }

  // Unfulfilled orders
  const unfulfilled = fulfillmentBreakdown.find((s) => s.status === 'UNFULFILLED' || s.status === 'UNKNOWN');
  if (unfulfilled && unfulfilled.count > 0) {
    insights.push(`${unfulfilled.count} pedido(s) pendientes de envío (${unfulfilled.percentage.toFixed(1)}% del total).`);
  }

  // Financial health
  const paid = financialBreakdown.find((s) => s.status === 'PAID');
  const paidRate = paid ? (paid.count / total) * 100 : 0;
  if (paidRate < 80) {
    insights.push(`Solo el ${paidRate.toFixed(1)}% de los pedidos están completamente pagados — revisar pagos pendientes.`);
  }

  // Refunds
  const refunded = financialBreakdown.filter((s) =>
    s.status === 'REFUNDED' || s.status === 'PARTIALLY_REFUNDED'
  );
  const refundCount = refunded.reduce((sum, s) => sum + s.count, 0);
  if (refundCount > 0) {
    const refundRate = (refundCount / total) * 100;
    insights.push(`Tasa de reembolsos: ${refundRate.toFixed(1)}% (${refundCount} pedidos).`);
  }

  return insights;
}

function generateFulfillmentRecommendations(insights: string[]): string[] {
  const recs: string[] = [];
  const text = insights.join(' ').toLowerCase();

  if (text.includes('baja') || text.includes('urgente')) {
    recs.push('Revisa el pipeline de fulfillment — identifica cuellos de botella en el proceso de envío.');
    recs.push('Considera automatizar notificaciones al equipo de logística para pedidos pendientes.');
  }

  if (text.includes('margen de mejora')) {
    recs.push('Establece SLAs de fulfillment (ej: enviar en <48h) y monitorea el cumplimiento.');
  }

  if (text.includes('reembolsos')) {
    recs.push('Analiza las razones de reembolso — pueden indicar problemas con la calidad del producto o descripciones inexactas.');
  }

  if (text.includes('pagos pendientes')) {
    recs.push('Configura recordatorios automáticos de pago para pedidos con cobro pendiente.');
  }

  if (text.includes('excelente')) {
    recs.push('Mantén el rendimiento actual. Considera optimizar tiempos de entrega como siguiente paso.');
  }

  if (recs.length === 0) {
    recs.push('Monitorea estas métricas semanalmente para detectar tendencias tempranas.');
  }

  return recs;
}

export async function handleGetFulfillmentMetrics(args: unknown): Promise<ToolResult> {
  try {
    const parsed = FulfillmentMetricsSchema.parse(args);
    const { period, startDate, endDate } = parsed;

    const { start, end } = getPeriodDates(period as Period, startDate, endDate);
    const queryStr = buildShopifyDateQuery(start, end);
    const data = await shopifyQuery<OrdersQueryResult>(ORDERS_BY_DATE_RANGE, { query: queryStr });
    const orders = data.orders.edges;

    const periodLabel = formatPeriodLabel(period as Period, start, end);

    // Build breakdowns
    const fulfillmentBreakdown = buildStatusBreakdown(orders, (o) => o.displayFulfillmentStatus);
    const financialBreakdown = buildStatusBreakdown(orders, (o) => o.displayFinancialStatus);

    // Calculate totals
    const totalRevenue = orders.reduce(
      (sum, { node }) => sum + parseFloat(node.totalPriceSet.shopMoney.amount),
      0
    );
    const currency = orders.length > 0 ? orders[0].node.totalPriceSet.shopMoney.currencyCode : 'ARS';
    const avgOrderValue = orders.length > 0 ? totalRevenue / orders.length : 0;

    let text = `📦 MÉTRICAS OPERATIVAS - ${periodLabel.toUpperCase()}\n`;
    text += `${formatNumber(orders.length)} pedidos | ${formatCurrency(totalRevenue, currency)} revenue | AOV: ${formatCurrency(avgOrderValue, currency)}\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Fulfillment breakdown
    text += `📤 ESTADO DE ENVÍO:\n`;
    for (const s of fulfillmentBreakdown) {
      const label = fulfillmentLabels[s.status] || s.status;
      const bar = '█'.repeat(Math.max(1, Math.round(s.percentage / 5)));
      text += `  ${bar} ${label}: ${formatNumber(s.count)} (${s.percentage.toFixed(1)}%) — ${formatCurrency(s.revenue, currency)}\n`;
    }

    // Financial breakdown
    text += `\n💳 ESTADO FINANCIERO:\n`;
    for (const s of financialBreakdown) {
      const label = financialLabels[s.status] || s.status;
      const bar = '█'.repeat(Math.max(1, Math.round(s.percentage / 5)));
      text += `  ${bar} ${label}: ${formatNumber(s.count)} (${s.percentage.toFixed(1)}%) — ${formatCurrency(s.revenue, currency)}\n`;
    }

    // Operational health score
    const fulfilled = fulfillmentBreakdown.find((s) => s.status === 'FULFILLED');
    const fulfillmentRate = orders.length > 0 && fulfilled ? (fulfilled.count / orders.length) * 100 : 0;
    const paid = financialBreakdown.find((s) => s.status === 'PAID');
    const paidRate = orders.length > 0 && paid ? (paid.count / orders.length) * 100 : 0;
    const healthScore = (fulfillmentRate * 0.6 + paidRate * 0.4);

    text += `\n🏥 SALUD OPERATIVA:\n`;
    text += `  • Tasa de fulfillment: ${formatPercentage(fulfillmentRate).replace('+', '')}\n`;
    text += `  • Tasa de cobro: ${formatPercentage(paidRate).replace('+', '')}\n`;
    text += `  • Score general: ${healthScore.toFixed(0)}/100 ${healthScore >= 80 ? '🟢' : healthScore >= 60 ? '🟡' : '🔴'}\n`;

    // Insights
    const insights = generateFulfillmentInsights(orders, fulfillmentBreakdown, financialBreakdown);
    text += `\n💡 INSIGHTS:\n`;
    for (const insight of insights) {
      text += `• ${insight}\n`;
    }

    // Recommendations
    const recs = generateFulfillmentRecommendations(insights);
    text += `\n📋 RECOMENDACIONES:\n`;
    for (const rec of recs) {
      text += `• ${rec}\n`;
    }

    return { content: [{ type: 'text', text }] };
  } catch (error) {
    return handleToolError(error);
  }
}
