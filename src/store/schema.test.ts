import { describe, expect, it } from 'vitest';
import { routineLength } from '../engine/plan';
import { activeTasks } from '../engine/routine';
import { add, done, editTask, makeRun, MIN, skip, task, undo } from '../engine/test-helpers';
import { fromBackup, seedData, toBackup, validateData } from './schema';

describe('store schema', () => {
  it('seeds the placeholder routine', () => {
    const tasks = seedData().routines[0]!.tasks;
    expect(tasks.map((t) => t.name)).toEqual([
      'Brush teeth',
      'Make coffee',
      "Prepare dog's breakfast",
      'Take dog for walk',
      'Wash hair',
      'Turn on iron',
      'Get clothes',
      'Iron clothes',
      'Change',
      'Do hair',
      'Pack bag',
    ]);
    const nameOf = (id: string) => tasks.find((t) => t.id === id)?.name;
    expect(tasks.find((t) => t.name === 'Iron clothes')!.after.map(nameOf)).toEqual(['Turn on iron', 'Get clothes']);
    expect(routineLength(activeTasks(tasks, new Set())) / MIN).toBe(46);
  });

  it('round-trips through a backup file, mornings included', () => {
    const data = seedData();
    const tap = done('teeth', 3);
    data.runs.push({
      ...makeRun(
        [task('teeth', 3)],
        [tap, undo(tap, 4), skip(['teeth'], 5), add(task('keys', 1), 'last', 6), editTask('keys', 'Find keys', 2, 7)],
        60,
      ),
      finishedAt: 1,
    });
    expect(fromBackup(toBackup(data))).toEqual(data);
  });

  it('rejects files that are not backups', () => {
    expect(() => fromBackup('not json')).toThrow(/backup/);
    expect(() => fromBackup('{"app":"something-else"}')).toThrow(/backup/);
    expect(() => fromBackup(JSON.stringify({ app: 'out-the-door', data: { version: 99 } }))).toThrow(/newer version/);
    const broken = JSON.parse(toBackup(seedData()));
    broken.data.routines[0].tasks[0].handsOnSec = 'three';
    expect(() => fromBackup(JSON.stringify(broken))).toThrow(/hands-on/);
  });

  it('forgets an in-progress morning that no longer exists', () => {
    const data = { ...seedData(), activeRunId: 'gone' };
    expect(validateData(JSON.parse(JSON.stringify(data))).activeRunId).toBeUndefined();
  });
});
