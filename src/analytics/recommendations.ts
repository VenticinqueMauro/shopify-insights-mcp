export function generateSalesRecommendations(insights: string[]): string[] {
  const recommendations: string[] = [];

  const insightText = insights.join(' ').toLowerCase();

  if (insightText.includes('cayeron') || insightText.includes('disminuyó') || insightText.includes('menos')) {
    recommendations.push('🎯 Considera lanzar una campaña promocional o descuentos para reactivar las ventas.');
    recommendations.push('📧 Activa una secuencia de email marketing para clientes inactivos.');
  }

  if (insightText.includes('ticket promedio bajó') || insightText.includes('upselling')) {
    recommendations.push('🛍️ Implementa bundles de productos o recomendaciones de cross-sell en el checkout.');
    recommendations.push('🎁 Ofrece envío gratuito a partir de un monto mínimo para incentivar tickets mayores.');
  }

  if (insightText.includes('crecieron') || insightText.includes('aumentó') || insightText.includes('más')) {
    recommendations.push('🚀 Aprovecha el momentum positivo aumentando la inversión en los canales de adquisición que mejor funcionan.');
    recommendations.push('📊 Analiza qué productos o categorías impulsaron el crecimiento para potenciarlos.');
  }

  if (insightText.includes('no se registraron ventas') || insightText.includes('estables')) {
    recommendations.push('🔍 Revisa los canales de marketing activos y evalúa nuevas fuentes de tráfico.');
    recommendations.push('💡 Considera realizar pruebas A/B en páginas de producto y el flujo de checkout.');
  }

  if (insightText.includes('volumen de pedidos aumentó')) {
    recommendations.push('📦 Asegúrate de tener suficiente stock para sostener el crecimiento en la demanda.');
  }

  // Always add a general recommendation
  recommendations.push('📈 Monitorea métricas clave diariamente: tasa de conversión, abandono de carrito y LTV de clientes.');

  return recommendations;
}
