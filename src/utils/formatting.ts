export function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatPercentage(value: number): string {
  if (value === 0 || Object.is(value, -0)) return '0%';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(value));
}

export function formatCurrencyChange(amount: number, currency: string = 'USD'): string {
  const normalized = amount === 0 ? 0 : amount;
  const sign = normalized > 0 ? '+' : '';
  return `${sign}${formatCurrency(normalized, currency)}`;
}
