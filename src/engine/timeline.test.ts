import { describe, expect, it } from 'vitest';
import { add, at, done, editTask, makeRun, MIN, mins, skip, task } from './test-helpers';
import { clockTicks, timeline } from './timeline';
import type { Run } from './types';

const tasks = [task('teeth', 3), task('walk', 20), task('change', 5), task('pack', 5)];

/** A run finished at minute `finishedMin`. */
const finishedRun = (events: Parameters<typeof makeRun>[1], finishedMin: number, finishByMin?: number): Run => ({
  ...makeRun(tasks, events, finishByMin),
  finishedAt: at(finishedMin),
});

describe('timeline', () => {
  it('lays out what you did, in order, against the plan, then what was skipped or left', () => {
    const run = finishedRun(
      [done('teeth', 4), editTask('walk', 'Take dog for walk', 15, 5), done('walk', 22), skip(['pack'], 22)],
      23,
      25,
    );
    const t = timeline(run);
    expect(
      t.rows.map((r) => [
        r.task.id,
        r.status,
        r.start === undefined ? null : mins(r.start),
        r.end === undefined ? null : mins(r.end),
        r.plannedMs / MIN,
      ]),
    ).toEqual([
      ['teeth', 'done', 0, 4, 3],
      ['walk', 'done', 4, 22, 15], // planned 15 after the rain change
      ['pack', 'skipped', null, null, 5],
      ['change', 'notDone', null, null, 5],
    ]);
    expect([mins(t.from), mins(t.to), mins(t.finishBy!)]).toEqual([0, 25, 25]);
  });

  it('flags one-off tasks', () => {
    const run: Run = {
      ...makeRun([task('teeth', 3)], [add(task('keys', 2), 'last', 1), done('teeth', 3), done('keys', 5)]),
      finishedAt: at(5),
    };
    expect(timeline(run).rows.map((r) => [r.task.id, r.oneOff, mins(r.start!)])).toEqual([
      ['teeth', false, 0],
      ['keys', true, 3],
    ]);
  });

  it('stretches to fit planned ends, but leaves out a finish-by time far beyond the finish', () => {
    // Teeth done in 1 minute against 3 planned: the axis still shows where it was planned to end.
    const quick = finishedRun([done('teeth', 1)], 1.5);
    expect(mins(timeline(quick).to)).toBe(3);
    const early = finishedRun([done('teeth', 3)], 3, 60);
    expect(timeline(early).finishBy).toBeUndefined();
    expect(mins(timeline(early).to)).toBe(3);
  });
});

describe('clock ticks', () => {
  it('picks round times, at most 5', () => {
    const clocks = (from: number, to: number) => clockTicks(at(from), at(to)).map((t) => mins(t));
    expect(clocks(34, 78)).toEqual([40, 50, 60, 70]); // 6:40 to 7:10, every 10 min
    expect(clocks(51, 54)).toEqual([51, 52, 53, 54]);
    expect(clocks(65, 155)).toEqual([90, 120, 150]); // 7:30, 8:00, 8:30
  });
});
