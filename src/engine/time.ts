// Local-time helpers. Dates are local calendar days as YYYY-MM-DD.

export const MINUTE = 60_000;

const pad = (n: number) => String(n).padStart(2, '0');

export function dateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDay(day: string): [number, number, number] {
  const [y = 1970, m = 1, d = 1] = day.split('-').map(Number);
  return [y, m, d];
}

/** Epoch ms of a local "HH:MM" on `day`. */
export function atTime(day: string, hhmm: string): number {
  const [y, m, d] = parseDay(day);
  const [hh = 0, mm = 0] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
}

/** Local "HH:MM" of an instant, for time inputs. */
export function toHhmm(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = parseDay(day);
  return dateKey(new Date(y, m - 1, d + n, 12).getTime());
}

/** The morning a plan made now is for: tomorrow, unless it's still the small hours. */
export function nextMorning(now: number): string {
  const today = dateKey(now);
  return new Date(now).getHours() < 4 ? today : addDays(today, 1);
}

/** Rounds up to the whole minute, so "out by 7:42" is never optimistic. */
export function ceilMinute(ms: number): number {
  return Math.ceil(ms / MINUTE) * MINUTE;
}

/** The next occurrence of a local "HH:MM" for something starting at `now`: today, unless that was over 12 hours ago. */
export function upcomingTime(hhmm: string, now: number): number {
  const today = atTime(dateKey(now), hhmm);
  return today < now - 12 * 60 * MINUTE ? atTime(addDays(dateKey(now), 1), hhmm) : today;
}
