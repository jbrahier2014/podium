// All times in the app are shown in Eastern time, whatever timezone the phone is in.

export const TZ = 'America/New_York';

// Dates follow the Podium voice guide: "Sun 25 Oct" (day before month, no commas).
const fmt = (opts, locale = 'en-US') => new Intl.DateTimeFormat(locale, { timeZone: TZ, ...opts });
const timeFmt = fmt({ hour: 'numeric', minute: '2-digit' });
const dayFmt = fmt({ weekday: 'short', day: 'numeric', month: 'short' }, 'en-GB');
const longDayFmt = fmt({ weekday: 'long', day: 'numeric', month: 'long' }, 'en-GB');
const partsFmt = fmt({ year: 'numeric', month: '2-digit', day: '2-digit' });

/** "7:05 PM" */
export function etTime(d) { return timeFmt.format(new Date(d)).replace(/\s?([AP]M)/, ' $1'); }

/** "Sun 25 Oct" */
export function etDay(d) { return dayFmt.format(new Date(d)).replace(',', ''); }

/** "Sunday 25 October" */
export function etLongDay(d) { return longDayFmt.format(new Date(d)).replace(',', ''); }

/** "YYYY-MM-DD" for the Eastern calendar date of a moment. */
export function etISODate(d = new Date()) {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(d)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** "YYYYMMDD" — the format ESPN's endpoints expect. */
export function etCompactDate(d = new Date()) { return etISODate(d).replaceAll('-', ''); }

/** Add whole days to a YYYY-MM-DD string. */
export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n, 12));
  return dt.toISOString().slice(0, 10);
}

/** "Today", "Yesterday", "Tomorrow", or "Sun 25 Oct" for an Eastern date string. */
export function relativeDayLabel(iso) {
  const today = etISODate();
  if (iso === today) return 'Today';
  if (iso === addDays(today, -1)) return 'Yesterday';
  if (iso === addDays(today, 1)) return 'Tomorrow';
  const [y, m, d] = iso.split('-').map(Number);
  return etDay(new Date(Date.UTC(y, m - 1, d, 16)));
}

/** "3h ago" style relative label for cache timestamps. */
export function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
