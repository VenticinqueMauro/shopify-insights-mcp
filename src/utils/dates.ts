export type Period = 'today' | 'yesterday' | 'week' | 'month' | 'custom';

function getTodayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function getPeriodDates(
  period: Period,
  startDate?: string,
  endDate?: string,
  timezone: string = 'UTC'
): { start: Date; end: Date } {
  switch (period) {
    case 'today': {
      const todayStr = getTodayInTimezone(timezone);
      const start = new Date(`${todayStr}T00:00:00`);
      const end = new Date(`${todayStr}T23:59:59.999`);
      return { start, end };
    }

    case 'yesterday': {
      const now = new Date();
      const yesterdayDate = new Date(now);
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      const yesterdayStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(yesterdayDate);
      const start = new Date(`${yesterdayStr}T00:00:00`);
      const end = new Date(`${yesterdayStr}T23:59:59.999`);
      return { start, end };
    }

    case 'week': {
      const todayStr = getTodayInTimezone(timezone);
      const end = new Date(`${todayStr}T23:59:59.999`);
      const startDate_ = new Date(`${todayStr}T00:00:00`);
      startDate_.setDate(startDate_.getDate() - 6);
      const start = startDate_;
      return { start, end };
    }

    case 'month': {
      const todayStr = getTodayInTimezone(timezone);
      const [y, m] = todayStr.split('-').map(Number);
      const start = new Date(`${y}-${String(m).padStart(2, '0')}-01T00:00:00`);
      const end = new Date(`${todayStr}T23:59:59.999`);
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
    d.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' });

  switch (period) {
    case 'today': return 'Today';
    case 'yesterday': return 'Yesterday';
    case 'week': return 'Last 7 days';
    case 'month': return 'This month';
    case 'custom': return `${fmt(start)} - ${fmt(end)}`;
    default: return `${fmt(start)} - ${fmt(end)}`;
  }
}

export function formatPreviousPeriodLabel(period: Period, start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' });

  switch (period) {
    case 'today': return 'Yesterday';
    case 'yesterday': return 'Day before yesterday';
    case 'week': return 'Previous week';
    case 'month': return 'Previous month';
    default: return `${fmt(start)} - ${fmt(end)}`;
  }
}
