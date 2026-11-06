// Calendar math. Dates are local calendar days stored as "YYYY-MM-DD".
// Weeks run Monday to Sunday; Week 1 of a cycle is the week containing its start date.

export const WEEKDAYS = [
  { n: 1, short: 'Mon', two: 'Mo', long: 'Monday' },
  { n: 2, short: 'Tue', two: 'Tu', long: 'Tuesday' },
  { n: 3, short: 'Wed', two: 'We', long: 'Wednesday' },
  { n: 4, short: 'Thu', two: 'Th', long: 'Thursday' },
  { n: 5, short: 'Fri', two: 'Fr', long: 'Friday' },
  { n: 6, short: 'Sat', two: 'Sa', long: 'Saturday' },
  { n: 7, short: 'Sun', two: 'Su', long: 'Sunday' },
];
export const weekday = (n) => WEEKDAYS[n - 1];

export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const todayISO = () => toISO(new Date());

/** Monday = 1 … Sunday = 7 */
export const isoWeekday = (d) => ((d.getDay() + 6) % 7) + 1;

export function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}
export const mondayOf = (d) => addDays(d, 1 - isoWeekday(d));

export function daysBetween(a, b) {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / 86400000);
}

export function weekNumber(cycle, iso = todayISO()) {
  const start = mondayOf(parseISO(cycle.startDate));
  const m = mondayOf(parseISO(iso));
  return Math.floor(daysBetween(start, m) / 7) + 1;
}

export const cycleStartMonday = (cycle) => mondayOf(parseISO(cycle.startDate));
export const cycleEnd = (cycle) => addDays(cycleStartMonday(cycle), cycle.weeks * 7 - 1);
export const dateFor = (cycle, week, wd) => addDays(cycleStartMonday(cycle), (week - 1) * 7 + wd - 1);

/** Today if it is a Monday, otherwise the coming Monday. */
export function nextMonday(d = new Date()) {
  const wd = isoWeekday(d);
  return wd === 1 ? addDays(d, 0) : addDays(d, 8 - wd);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Sep 21" */
export const fmtDay = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
/** "Thursday, Nov 5" */
export const fmtLong = (d) => `${weekday(isoWeekday(d)).long}, ${fmtDay(d)}`;
/** "Mon, Nov 9" */
export const fmtShortWeekday = (d) => `${weekday(isoWeekday(d)).short}, ${fmtDay(d)}`;
