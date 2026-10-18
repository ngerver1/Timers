import { describe, expect, it } from 'vitest';
import { activeTasks } from './routine';
import { simulate, type Schedule } from './simulate';
import { MIN, morning, task } from './test-helpers';

const order = (s: Schedule) => s.slots.map((x) => x.task.id);
const startOf = (s: Schedule, id: string) => s.slots.find((x) => x.task.id === id)!.start / MIN;

describe('simulate', () => {
  it('does hands-on parts one after another, in priority order', () => {
    const s = simulate({ tasks: activeTasks(morning, new Set()), from: 0 });
    expect(order(s)).toEqual(['teeth', 'coffee', 'dogFood', 'walk', 'clothes', 'change', 'doHair']);
    expect(s.finish).toBe(46 * MIN);
  });

  it('with everything on, heats the iron while you get clothes', () => {
    const on = new Set(['washHair', 'ironOn', 'iron', 'packBag']);
    const s = simulate({ tasks: activeTasks(morning, on), from: 0 });
    expect(order(s)).toEqual([
      'teeth',
      'coffee',
      'dogFood',
      'walk',
      'washHair',
      'ironOn',
      'clothes',
      'iron',
      'change',
      'doHair',
      'packBag',
    ]);
    expect(startOf(s, 'iron')).toBe(41.5); // iron hot and clothes out at the same moment
    expect(s.finish).toBe(69.5 * MIN);
  });

  it('lets a wait overlap other work', () => {
    const s = simulate({ tasks: [task('coffee', 2, { wait: 4 }), task('dogFood', 3), task('walk', 20)], from: 0 });
    expect(s.finish).toBe(25 * MIN); // the brew happens during the dog's breakfast
  });

  it('lets two waits overlap each other', () => {
    const s = simulate({
      tasks: [task('coffee', 2, { wait: 4 }), task('ironOn', 1, { wait: 3 }), task('teeth', 3)],
      from: 0,
    });
    expect(s.slots.map((x) => x.finish / MIN)).toEqual([6, 6, 6]);
    expect(s.finish).toBe(6 * MIN);
  });

  it('counts a wait still running at the end', () => {
    const early = simulate({ tasks: [task('coffee', 2, { wait: 4 }), task('teeth', 3)], from: 0 });
    expect(early.finish).toBe(6 * MIN); // teeth done at 5, coffee ready at 6
    const late = simulate({ tasks: [task('teeth', 3), task('coffee', 2, { wait: 4 })], from: 0 });
    expect(late.finish).toBe(9 * MIN);
  });

  it('waits for an "after" task to finish, wait included, doing ready tasks meanwhile', () => {
    const s = simulate({
      tasks: [task('ironOn', 1, { wait: 5 }), task('iron', 2, { after: ['ironOn'] }), task('clothes', 3)],
      from: 0,
    });
    expect(order(s)).toEqual(['ironOn', 'clothes', 'iron']);
    expect(startOf(s, 'clothes')).toBe(1);
    expect(startOf(s, 'iron')).toBe(6); // idle from 4 to 6
    expect(s.finish).toBe(8 * MIN);
  });

  it('is idle when nothing is ready', () => {
    const s = simulate({ tasks: [task('a', 1, { wait: 5 }), task('b', 2, { after: ['a'] })], from: 0 });
    expect(startOf(s, 'b')).toBe(6);
    expect(s.finish).toBe(8 * MIN);
  });

  it('takes a later task first if it is ready and an earlier one is not', () => {
    const s = simulate({
      tasks: [task('change', 5, { after: ['clothes'] }), task('clothes', 3), task('teeth', 3)],
      from: 0,
    });
    expect(order(s)).toEqual(['clothes', 'change', 'teeth']);
  });

  it('ignores rules pointing at tasks that are not on today', () => {
    const s = simulate({ tasks: [task('doHair', 10, { after: ['washHair'] })], from: 0 });
    expect(startOf(s, 'doHair')).toBe(0);
  });

  it('respects finish times of tasks already done', () => {
    const s = simulate({
      tasks: [task('b', 2, { after: ['a'] })],
      from: 0,
      finished: new Map([['a', 3 * MIN]]),
    });
    expect(startOf(s, 'b')).toBe(3);
  });

  it('stretches a task that started before now and is not done yet', () => {
    const s = simulate({ tasks: [task('a', 3), task('b', 2)], from: 0, now: 5 * MIN });
    expect(s.slots[0]!.handsOnEnd).toBe(5 * MIN);
    expect(s.finish).toBe(7 * MIN);
  });

  it('does not hang on a loop of rules', () => {
    const s = simulate({ tasks: [task('a', 1, { after: ['b'] }), task('b', 1, { after: ['a'] })], from: 0 });
    expect(s.slots).toHaveLength(2);
  });
});
