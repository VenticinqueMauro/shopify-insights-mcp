import type { SalesSignals } from './insights.js';

export function generateSalesRecommendations(signals: SalesSignals): string[] {
  const recommendations: string[] = [];

  if (signals.revenueDown || signals.ordersDown) {
    recommendations.push('🎯 Consider launching a promotional campaign or discounts to reactivate sales.');
    recommendations.push('📧 Activate an email marketing sequence targeting inactive customers.');
  }

  if (signals.aovDown) {
    recommendations.push('🛍️ Implement product bundles or cross-sell recommendations at checkout.');
    recommendations.push('🎁 Offer free shipping above a minimum order amount to incentivize higher cart values.');
  }

  if (signals.revenueUp || signals.ordersUp) {
    recommendations.push('🚀 Capitalize on positive momentum by increasing investment in your best-performing acquisition channels.');
    recommendations.push('📊 Analyze which products or categories drove growth to amplify them.');
  }

  if (signals.noSales || signals.stableRevenue) {
    recommendations.push('🔍 Review active marketing channels and evaluate new traffic sources.');
    recommendations.push('💡 Consider running A/B tests on product pages and the checkout flow.');
  }

  if (signals.ordersUp) {
    recommendations.push('📦 Ensure sufficient stock to sustain growing demand.');
  }

  // Always add a general recommendation
  recommendations.push('📈 Monitor key metrics daily: conversion rate, cart abandonment, and customer LTV.');

  return recommendations;
}
