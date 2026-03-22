import { calculateChange } from './comparisons.js';

export interface SalesMetrics {
  revenue: number;
  orders: number;
  averageOrderValue: number;
  itemsSold: number;
}

export function generateSalesInsights(
  current: SalesMetrics,
  previous?: SalesMetrics
): string[] {
  const insights: string[] = [];

  if (!previous) {
    if (current.revenue === 0) {
      insights.push('📭 No se registraron ventas en el período seleccionado.');
    } else {
      insights.push(`💰 Se generaron ${current.orders} pedidos con un ticket promedio de $${current.averageOrderValue.toFixed(2)}.`);
      insights.push(`📦 Se vendieron ${current.itemsSold} unidades en total.`);
    }
    return insights;
  }

  const revenueChange = calculateChange(current.revenue, previous.revenue);
  const ordersChange = calculateChange(current.orders, previous.orders);
  const aovChange = calculateChange(current.averageOrderValue, previous.averageOrderValue);
  const itemsChange = calculateChange(current.itemsSold, previous.itemsSold);

  // Revenue insight
  if (revenueChange.direction === 'up') {
    insights.push(`📈 Los ingresos crecieron un ${revenueChange.percentage.toFixed(1)}% respecto al período anterior.`);
  } else if (revenueChange.direction === 'down') {
    insights.push(`📉 Los ingresos cayeron un ${Math.abs(revenueChange.percentage).toFixed(1)}% respecto al período anterior.`);
  } else {
    insights.push(`➡️ Los ingresos se mantuvieron estables respecto al período anterior.`);
  }

  // Orders insight
  if (ordersChange.direction === 'up') {
    insights.push(`🛒 El volumen de pedidos aumentó un ${ordersChange.percentage.toFixed(1)}% (${ordersChange.value > 0 ? '+' : ''}${Math.round(ordersChange.value)} pedidos).`);
  } else if (ordersChange.direction === 'down') {
    insights.push(`🛒 El volumen de pedidos disminuyó un ${Math.abs(ordersChange.percentage).toFixed(1)}% (${Math.round(ordersChange.value)} pedidos).`);
  }

  // AOV insight
  if (aovChange.direction === 'up') {
    insights.push(`💳 El ticket promedio aumentó un ${aovChange.percentage.toFixed(1)}%, lo que indica mayor valor por transacción.`);
  } else if (aovChange.direction === 'down') {
    insights.push(`💳 El ticket promedio bajó un ${Math.abs(aovChange.percentage).toFixed(1)}%, considera estrategias de upselling.`);
  }

  // Items sold insight
  if (itemsChange.direction === 'up') {
    insights.push(`📦 Se vendieron ${Math.round(itemsChange.value)} unidades más que en el período anterior.`);
  } else if (itemsChange.direction === 'down') {
    insights.push(`📦 Se vendieron ${Math.abs(Math.round(itemsChange.value))} unidades menos que en el período anterior.`);
  }

  if (insights.length === 0) {
    insights.push('📊 El rendimiento fue similar al período anterior.');
  }

  return insights;
}
