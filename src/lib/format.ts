/*
 * Small formatting helpers so API data renders exactly like the strings the
 * screens were designed around ("5 mins ago", "#MB1452", "₹486", "1.2 km").
 */

/**
 * The API sends UTC timestamps WITHOUT a timezone suffix
 * (e.g. "2026-10-14T10:37:00"). JavaScript would read that as local time,
 * so mark it as UTC first.
 */
export function parseApiDate(
  value: string | null | undefined
): Date | null {
  if (!value) {
    return null;
  }

  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value);

  const date = new Date(hasZone ? value : `${value}Z`);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function timeAgo(value: string | null | undefined): string {
  const date = parseApiDate(value);

  if (!date) {
    return '';
  }

  const minutes = Math.max(
    0,
    Math.floor((Date.now() - date.getTime()) / 60000)
  );

  if (minutes < 1) {
    return 'Just now';
  }

  if (minutes < 60) {
    return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  }

  const days = Math.floor(hours / 24);

  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function clock(date: Date): string {
  let hours = date.getHours();

  const minutes = String(date.getMinutes()).padStart(2, '0');

  const suffix = hours >= 12 ? 'PM' : 'AM';

  hours = hours % 12 || 12;

  return `${hours}:${minutes} ${suffix}`;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** "Today, 10:37 AM" · "Yesterday, 4:05 PM" · "12 Oct, 9:20 AM" */
export function formatDayTime(value: string | null | undefined): string {
  const date = parseApiDate(value);

  if (!date) {
    return '';
  }

  const now = new Date();

  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();

  const startOfDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ).getTime();

  const dayDiff = Math.round((startOfToday - startOfDate) / 86400000);

  if (dayDiff === 0) {
    return `Today, ${clock(date)}`;
  }

  if (dayDiff === 1) {
    return `Yesterday, ${clock(date)}`;
  }

  return `${date.getDate()} ${MONTHS[date.getMonth()]}, ${clock(date)}`;
}

/** Last 6 characters of the UUID, e.g. "#4F9A1C". Used as the visible order number. */
export function shortId(apiId: string): string {
  return `#${apiId.replace(/-/g, '').slice(-6).toUpperCase()}`;
}

export function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

/** 486 -> "₹486" · 486.5 -> "₹486.50" */
export function formatRupees(value: string | number | null | undefined): string {
  const amount = toNumber(value);

  return Number.isInteger(amount)
    ? `₹${amount}`
    : `₹${amount.toFixed(2)}`;
}

/** 4210 -> "₹4.2K" */
export function formatRupeesCompact(
  value: string | number | null | undefined
): string {
  const amount = toNumber(value);

  if (amount >= 1000) {
    return `₹${(amount / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  }

  return formatRupees(amount);
}

export function formatKm(value: number | null | undefined): string {
  return `${(value ?? 0).toFixed(1)} km`;
}

export function pluralItems(count: number): string {
  return `${count} ${count === 1 ? 'item' : 'items'}`;
}
