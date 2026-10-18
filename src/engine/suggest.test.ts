import { describe, expect, it } from 'vitest';
import { activeTasks } from './routine';
import { foldRun } from './run';
import { suggestDrops } from './suggest';
import { at, makeRun, mins, morning, T0 } from './test-helpers';

const allOn = activeTasks(morning, new Set(['washHair', 'ironOn', 'iron', 'packBag'])); // 69.5 min
const ids = (s: ReturnType<typeof suggestDrops>) => s?.drop.map((t) => t.id);

describe('suggestDrops', () => {
  it('says nothing when you are on time', () => {
    expect(suggestDrops(foldRun(makeRun(allOn)), T0, at(70))).toBeUndefined();
  });

  it('suggests the fewest optional tasks that get you back on time', () => {
    const s = suggestDrops(foldRun(makeRun(allOn)), T0, at(60));
    expect(ids(s)).toEqual(['washHair']);
    expect(s?.onTime).toBe(true);
    expect(mins(s!.outTheDoor)).toBe(59.5);
  });

  it('prefers the drop that cuts least when several would do', () => {
    const s = suggestDrops(foldRun(makeRun(allOn)), T0, at(65));
    expect(ids(s)).toEqual(['packBag']); // 64.5; wash hair would also do, but cuts more
  });

  it('drops a task together with what only it needed', () => {
    const tasks = activeTasks(morning, new Set(['ironOn', 'iron'])); // 54.5 min
    const s = suggestDrops(foldRun(makeRun(tasks)), T0, at(54));
    expect(ids(s)).toEqual(['ironOn', 'iron']);
    expect(mins(s!.outTheDoor)).toBe(46);
  });

  it('when nothing is enough, gets as close as it can', () => {
    const s = suggestDrops(foldRun(makeRun(allOn)), T0, at(30));
    expect(s?.onTime).toBe(false);
    expect(ids(s)).toEqual(['washHair', 'ironOn', 'iron', 'packBag']);
    expect(mins(s!.outTheDoor)).toBe(46);
  });

  it('accounts for time already lost', () => {
    // Still on the first task 9 minutes in: 6 minutes over, so out at 75.5.
    const s = suggestDrops(foldRun(makeRun(allOn)), at(9), at(71));
    expect(ids(s)).toEqual(['packBag']);
    expect(mins(s!.outTheDoor)).toBe(70.5);
  });
});
