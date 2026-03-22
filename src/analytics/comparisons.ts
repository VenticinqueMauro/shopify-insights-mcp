export interface ChangeResult {
  value: number;
  percentage: number;
  direction: 'up' | 'down' | 'flat';
}

export function calculateChange(current: number, previous: number): ChangeResult {
  const value = current - previous;

  if (previous === 0) {
    if (current > 0) {
      return { value, percentage: 100, direction: 'up' };
    }
    return { value: 0, percentage: 0, direction: 'flat' };
  }

  const percentage = ((current - previous) / previous) * 100;
  const direction: 'up' | 'down' | 'flat' =
    percentage > 0.05 ? 'up' : percentage < -0.05 ? 'down' : 'flat';

  return { value, percentage, direction };
}
