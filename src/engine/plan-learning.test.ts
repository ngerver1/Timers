import { describe, expect, it } from 'vitest';
import { median, tidySeconds, usualTimes } from './learning';
import { getUpTime, routineLength } from './plan';
import { activeTasks } from './routine';
import { foldRun } from './run';
import { at, done, makeRun, MIN, morning, skip, task } from './test-helpers';
import { addDays, atTime, ceilMinute, dateKey, nextMorning, toHhmm } from './time';
import { waitsEndedBetween } from './waits';

describe('plan', () => {
  it('works back from leave-by to a get-up time', () => {
    const today = activeTasks(morning, new Set());
    expect(routineLength(today)).toBe(46 * MIN);
    expect(getUpTime(today, at(90), 10)).toBe(at(90 - 46 - 10));
  });
});

describe('learning', () => {
  it('takes the median', () => {
    expect(median([])).toBeUndefined();
    expect(median([3])).toBe(3);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('uses the last 10 mornings that included the task', () => {
    const teeth = [task('teeth', 3)];
    const tookMinutes = (m: number) => makeRun(teeth, [done('teeth', m)]);
    const runs = [
      makeRun(teeth, [skip(['teeth'], 0)]), // newest: skipped, so it doesn't count
      ...[3, 3, 3, 4, 4, 4, 4, 5, 5, 5].map(tookMinutes),
      tookMinutes(20), // older than the last 10
      tookMinutes(20),
    ];
    expect(usualTimes(runs).get('teeth')).toEqual({ medianSec: 240, samples: 10 });
  });

  it('rounds an adopted time to 15 seconds', () => {
    expect(tidySeconds(187)).toBe(180);
    expect(tidySeconds(188)).toBe(195);
    expect(tidySeconds(3)).toBe(15);
  });
});

describe('waits', () => {
  it('reports a wait ending between two moments', () => {
    const state = foldRun(makeRun([task('coffee', 2, { wait: 4 }), task('teeth', 3)], [done('coffee', 2)]));
    expect(waitsEndedBetween(state, at(5), at(5.5))).toEqual([]);
    expect(waitsEndedBetween(state, at(5.5), at(6)).map((d) => d.task.id)).toEqual(['coffee']);
    expect(waitsEndedBetween(state, at(6), at(7))).toEqual([]);
  });
});

describe('time', () => {
  it('plans for tomorrow, unless it is still the small hours', () => {
    expect(nextMorning(new Date(2026, 9, 18, 21, 0).getTime())).toBe('2026-10-19');
    expect(nextMorning(new Date(2026, 9, 19, 1, 0).getTime())).toBe('2026-10-19');
  });

  it('converts between days, times and instants', () => {
    const t = atTime('2026-10-19', '07:45');
    expect(dateKey(t)).toBe('2026-10-19');
    expect(toHhmm(t)).toBe('07:45');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(ceilMinute(t + 1)).toBe(t + MIN);
    expect(ceilMinute(t)).toBe(t);
  });
});
