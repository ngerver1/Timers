// Display formatting. Uses the phone's locale (en-AU gives "7:45 am").
import { ceilMinute, MINUTE } from '../engine/time';
import type { Task } from '../engine/types';
import { features } from '../features';

const clockFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/** "7:45" and "am" separately, so the period can be set smaller. */
export function clockParts(ms: number): { time: string; period: string } {
  const parts = clockFormat.formatToParts(ms);
  const period = parts.find((p) => p.type === 'dayPeriod')?.value.toLowerCase() ?? '';
  const time = parts
    .filter((p) => p.type !== 'dayPeriod')
    .map((p) => p.value)
    .join('')
    .trim();
  return { time, period };
}

export function clock(ms: number): string {
  const { time, period } = clockParts(ms);
  return period ? `${time} ${period}` : time;
}

/** "Mon 19 Oct" for a YYYY-MM-DD day. */
export function dayLabel(day: string): string {
  const [y = 1970, m = 1, d = 1] = day.split('-').map(Number);
  return dayFormat.format(new Date(y, m - 1, d)).replace(',', '');
}

/** "3 min", "3½ min", "45 s", "1 min 20 s", "1 h 9½ min". */
export function duration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const rest = s - h * 3600;
  let tail = '';
  if (rest % 30 === 0) {
    if (rest > 0) tail = `${Math.floor(rest / 60) || ''}${rest % 60 ? '½' : ''} min`;
  } else if (rest < 60) {
    tail = `${rest} s`;
  } else {
    tail = `${Math.floor(rest / 60)} min ${rest % 60} s`;
  }
  if (h === 0) return tail || '0 min';
  return tail ? `${h} h ${tail}` : `${h} h`;
}

/** "1:05" (m:ss) or "1:02:05". */
export function timer(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "3 min", or "2 min + 4 min wait" once waits are switched on. */
export function taskLength(task: Pick<Task, 'handsOnSec' | 'waitSec'>): string {
  return features.waits && task.waitSec > 0
    ? `${duration(task.handsOnSec)} + ${duration(task.waitSec)} wait`
    : duration(task.handsOnSec);
}

/** Estimate vs leave-by, both to the whole minute (the estimate rounded up). */
export function slack(leaveBy: number, outAt: number): { text: string; tone: 'ahead' | 'even' | 'behind' } {
  const diff = Math.round((leaveBy - ceilMinute(outAt)) / MINUTE);
  if (diff > 0) return { text: `${duration(diff * 60)} spare`, tone: 'ahead' };
  if (diff < 0) return { text: `${duration(-diff * 60)} behind`, tone: 'behind' };
  return { text: 'Right on time', tone: 'even' };
}

/** The estimate against the plan at Start: "+3 min vs plan", "−2 min vs plan" or "On plan". */
export function drift(outAt: number, planned: number): { text: string; tone: 'ahead' | 'even' | 'behind' } {
  const diff = Math.round((ceilMinute(outAt) - ceilMinute(planned)) / MINUTE);
  if (diff > 0) return { text: `+${duration(diff * 60)} vs plan`, tone: 'behind' };
  if (diff < 0) return { text: `−${duration(-diff * 60)} vs plan`, tone: 'ahead' };
  return { text: 'On plan', tone: 'even' };
}

/** For finished mornings: "4 min early", "3 min late", "on time". */
export function earlyLate(leaveBy: number, outAt: number): string {
  const diff = Math.round((leaveBy - outAt) / MINUTE);
  if (diff > 0) return `${duration(diff * 60)} early`;
  if (diff < 0) return `${duration(-diff * 60)} late`;
  return 'on time';
}

/** Minutes as typed ("3", "0.5", "2,5"), or undefined if not a valid amount. */
export function parseMinutes(text: string): number | undefined {
  const value = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 24 * 60 ? value : undefined;
}

/** Seconds shown as minutes in an input: 30 → "0.5", 195 → "3.25". */
export function minutesText(sec: number): string {
  return String(Math.round((sec / 60) * 100) / 100);
}

export const listNames = (names: string[]): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
