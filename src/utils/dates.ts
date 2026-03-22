export type Period = 'today' | 'yesterday' | 'week' | 'month' | 'custom';

export function getPeriodDates(
  period: Period,
  startDate?: string,
  endDate?: string
): { start: Date; end: Date } {
  const now = new Date();

  switch (period) {
    case 'today': {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }

    case 'yesterday': {
      const start = new Date(now);
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }

    case 'week': {
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }

    case 'month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }

    case 'custom': {
      if (!startDate || !endDate) {
        throw new Error('startDate and endDate are required for custom period');
      }
      const start = new Date(`${startDate}T00:00:00.000Z`);
      const end = new Date(`${endDate}T23:59:59.999Z`);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new Error('Invalid date format. Use YYYY-MM-DD');
      }
      if (start > end) {
        throw new Error('startDate must be before or equal to endDate');
      }
      return { start, end };
    }

    default:
      throw new Error(`Unknown period: ${period}`);
  }
}

export function getPreviousPeriodDates(
  start: Date,
  end: Date
): { start: Date; end: Date } {
  const durationMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  return { start: prevStart, end: prevEnd };
}

export function formatDateForShopify(date: Date): string {
  return date.toISOString();
}

function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function buildShopifyDateQuery(start: Date, end: Date): string {
  return `processed_at:>=${toLocalDateString(start)} processed_at:<=${toLocalDateString(end)}`;
}

export function formatPeriodLabel(period: Period, start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

  switch (period) {
    case 'today': return 'Hoy';
    case 'yesterday': return 'Ayer';
    case 'week': return 'Últimos 7 días';
    case 'month': return 'Este mes';
    case 'custom': return `${fmt(start)} - ${fmt(end)}`;
    default: return `${fmt(start)} - ${fmt(end)}`;
  }
}

export function formatPreviousPeriodLabel(period: Period, start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

  switch (period) {
    case 'today': return 'Ayer';
    case 'yesterday': return 'Anteayer';
    case 'week': return 'Semana anterior';
    case 'month': return 'Mes anterior';
    default: return `${fmt(start)} - ${fmt(end)}`;
  }
}
