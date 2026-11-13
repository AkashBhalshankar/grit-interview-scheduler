// IST helpers with no Intl dependency, so output is identical in every browser and in Node.
export const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const IST_MS = 330 * MIN;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

export function istParts(ms) {
  const d = new Date(ms + IST_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay(), h: d.getUTCHours(), min: d.getUTCMinutes() };
}
export const fmtTime = (ms) => { const p = istParts(ms); return `${p.h % 12 || 12}:${pad(p.min)} ${p.h < 12 ? 'AM' : 'PM'}`; };
export const fmtDt = (ms) => { const p = istParts(ms); return `${DOW[p.dow]} ${p.d} ${MON[p.m]}, ${fmtTime(ms)} IST`; };   // 'Thu 13 Nov, 4:00 PM IST'
export const fmtDate = (ms) => { const p = istParts(ms); return `${p.d} ${MON[p.m]}`; };                                   // '13 Nov'
export const fmtDay = (ms) => { const p = istParts(ms); return `${DOW[p.dow]} ${p.d} ${MON[p.m]}`; };                       // 'Thu 13 Nov'
export const dayKey = (ms) => { const p = istParts(ms); return `${p.y}-${pad(p.m + 1)}-${pad(p.d)}`; };                    // IST calendar day
export const parseIST = (day, hhmm) => {
  const ms = Date.parse(`${day}T${hhmm}:00+05:30`);
  if (Number.isNaN(ms)) throw new Error(`Bad date/time: ${day} ${hhmm}`);
  return ms;
};
export const startOfDay = (key) => parseIST(key, '00:00');
export const addDays = (key, n) => dayKey(startOfDay(key) + n * DAY + 12 * HOUR);
export const hhmm = (ms) => { const p = istParts(ms); return `${pad(p.h)}:${pad(p.min)}`; };
export const relative = (ms, now) => {
  const diff = ms - now, a = Math.abs(diff), sign = diff >= 0 ? 'in ' : '';
  const suffix = diff < 0 ? ' ago' : '';
  if (a < 2 * MIN) return 'just now';
  if (a < HOUR) return `${sign}${Math.max(1, Math.round(a / MIN))} min${suffix}`;
  if (a < DAY) return `${sign}${Math.round(a / HOUR)} h${suffix}`;
  return `${sign}${Math.round(a / DAY)} d${suffix}`;
};
