import { describe, expect, it } from 'vitest';
import { biggestOverrun, madeIt, minuteScale, runTimes, summarise, trend } from './insights';
import { at, done, makeRun, MIN, task } from './test-helpers';
import type { Run } from './types';

const plan = [task('teeth', 3), task('walk', 20), task('change', 5)]; // 28 min planned

/** A finished run that took `took` minutes, optionally with a finish-by time. */
const finished = (took: number, finishByMin?: number): Run => ({
  ...makeRun(plan, [], finishByMin),
  finishedAt: at(took),
});

describe('run times', () => {
  it('takes each finished run from start to finish, against the plan at Start', () => {
    const open = makeRun(plan);
    const times = runTimes([finished(31), open, finished(26)]);
    expect(times.map((t) => [t.tookMs / MIN, t.plannedMs / MIN])).toEqual([
      [31, 28],
      [26, 28],
    ]);
  });

  it('times a real run from its first tap to Out the door', () => {
    const run: Run = { ...makeRun(plan, [done('teeth', 3), done('walk', 29)]), finishedAt: at(29.5) };
    expect(runTimes([run])[0]!.tookMs).toBe(29.5 * MIN);
  });

  it('counts a run as on time to the minute, like History says it', () => {
    expect(madeIt(finished(30, 30))).toBe(true);
    expect(madeIt(finished(30.4, 30))).toBe(true); // "on time"
    expect(madeIt(finished(30.6, 30))).toBe(false); // "1 min late"
    expect(madeIt(finished(25))).toBe(false); // no finish-by time
  });
});

describe('summary', () => {
  it('gives the typical time, how it compares with the plan, and the on-time record', () => {
    // Newest first.
    const times = runTimes([finished(30, 35), finished(34, 32), finished(29), finished(31, 40)]);
    expect(summarise(times)).toEqual({
      count: 4,
      typicalMs: 30.5 * MIN,
      vsPlanMs: 2.5 * MIN,
      onTime: { made: 2, of: 3 },
    });
  });

  it('only looks at the newest runs, and has nothing to say about none', () => {
    const times = runTimes([finished(30), finished(30), finished(60), finished(60)]);
    expect(summarise(times, 2)?.typicalMs).toBe(30 * MIN);
    expect(summarise([])).toBeUndefined();
    expect(summarise(times)?.onTime).toBeUndefined();
  });
});

describe('trend', () => {
  it('compares the newest runs with the ones before, in groups of up to 5', () => {
    const newestFirst = [30, 31, 29, 30, 32, 35, 36, 34, 35, 37, 50].map((m) => finished(m));
    expect(trend(runTimes(newestFirst))).toEqual({ size: 5, recentMs: 30 * MIN, earlierMs: 35 * MIN });
    expect(trend(runTimes(newestFirst.slice(0, 7)))).toEqual({ size: 3, recentMs: 30 * MIN, earlierMs: 32 * MIN });
  });

  it('waits for at least 3 runs in each group', () => {
    expect(trend(runTimes([30, 31, 29, 30, 32].map((m) => finished(m))))).toBeUndefined();
  });
});

describe('biggest overrun', () => {
  const defs = [
    { id: 'teeth', name: 'Brush teeth', handsOnSec: 180, waitSec: 0, after: [] },
    { id: 'walk', name: 'Take dog for walk', handsOnSec: 1200, waitSec: 0, after: [] },
    { id: 'change', name: 'Change', handsOnSec: 300, waitSec: 0, after: [] },
  ];

  it('picks the task furthest over its standard time, tidied the way Use sets it', () => {
    const usual = new Map([
      ['teeth', { medianSec: 250, samples: 5 }], // 1 min over
      ['walk', { medianSec: 1562, samples: 4 }], // 6 min over
      ['change', { medianSec: 200, samples: 6 }], // under
    ]);
    expect(biggestOverrun(defs, usual)).toEqual({ task: defs[1], usualSec: 1560, overSec: 360 });
  });

  it('ignores small differences and tasks seen fewer than 3 times', () => {
    const usual = new Map([
      ['teeth', { medianSec: 230, samples: 5 }], // under a minute over
      ['walk', { medianSec: 1800, samples: 2 }],
    ]);
    expect(biggestOverrun(defs, usual)).toBeUndefined();
  });
});

describe('chart scale', () => {
  it('rounds up to a tidy top with at most 4 gridline steps', () => {
    expect(minuteScale(52 * MIN)).toEqual({ top: 60, step: 15 });
    expect(minuteScale(61 * MIN)).toEqual({ top: 90, step: 30 });
    expect(minuteScale(3 * MIN)).toEqual({ top: 5, step: 5 });
    expect(minuteScale(0)).toEqual({ top: 5, step: 5 });
  });
});
