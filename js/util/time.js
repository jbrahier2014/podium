// All times in the app are shown in Eastern time, whatever timezone the phone is in.

export const TZ = 'America/New_York';

// Dates read Day, Month Date everywhere: "Sat, Oct 31" where space is tight,
// "Saturday, October 31" in full, "Sunday, October 25, 2026" on Home.
const fmt = (opts, locale = 'en-US') => new Intl.DateTimeFormat(locale, { timeZone: TZ, ...opts });
const timeFmt = fmt({ hour: 'numeric', minute: '2-digit' });
const dayFmt = fmt({ weekday: 'short', month: 'short', day: 'numeric' });
const longDayFmt = fmt({ weekday: 'long', month: 'long', day: 'numeric' });
const partsFmt = fmt({ year: 'numeric', month: '2-digit', day: '2-digit' });

/** "7:05 PM" */
export function etTime(d) { return timeFmt.format(new Date(d)).replace(/\s?([AP]M)/, ' $1'); }

/** "Sat, Oct 31" */
export function etDay(d) { return dayFmt.format(new Date(d)); }

/** "Saturday, October 31" */
export function etLongDay(d) { return longDayFmt.format(new Date(d)); }

/** "Sunday, October 25, 2026" (Eastern), for Home's date line. */
const fullDateFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
export function etFullDate(d = new Date()) { return fullDateFmt.format(new Date(d)); }

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

/** "Today", "Yesterday", "Tomorrow", or "Sat, Oct 31" for an Eastern date string. */
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

/** "27 Sep" (older nightly files) -> "Sep 27"; "2026-03-27" -> "Mar 27"; anything else unchanged. */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function monthDay(label) {
  if (typeof label !== 'string') return label;
  const dm = label.match(/^(\d{1,2}) ([A-Z][a-z]{2})$/);
  if (dm) return `${dm[2]} ${dm[1]}`;
  const iso = label.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (iso) return `${MON[Number(iso[1]) - 1]} ${Number(iso[2])}`;
  return label;
}
