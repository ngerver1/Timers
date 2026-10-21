import { describe, expect, it } from 'vitest';
import { routineLength } from '../engine/plan';
import { activeTasks } from '../engine/routine';
import { add, done, editTask, makeRun, MIN, skip, task, undo } from '../engine/test-helpers';
import { dayTasks, flowTasks, flowsUsing, planTasks, ruleGraph, withChange } from './flows';
import { fromBackup, seedData, toBackup, validateData } from './schema';

describe('store schema', () => {
  it('seeds the placeholder morning as one flow over a shared task list', () => {
    const data = seedData();
    const tasks = flowTasks(data.tasks, data.flows[0]!);
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
    expect(tasks.filter((t) => t.optional).map((t) => t.name)).toEqual([
      'Wash hair',
      'Turn on iron',
      'Iron clothes',
      'Pack bag',
    ]);
    const nameOf = (id: string) => tasks.find((t) => t.id === id)?.name;
    expect(tasks.find((t) => t.name === 'Iron clothes')!.after.map(nameOf)).toEqual(['Turn on iron', 'Get clothes']);
    expect(routineLength(activeTasks(tasks, new Set())) / MIN).toBe(46);
  });

  it('round-trips through a backup file, runs included', () => {
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
    data.flows[0]!.usual = { mode: 'startAt', time: '06:30' };
    expect(fromBackup(toBackup(data))).toEqual(data);
  });

  it('rejects files that are not backups', () => {
    expect(() => fromBackup('not json')).toThrow(/backup/);
    expect(() => fromBackup('{"app":"something-else"}')).toThrow(/backup/);
    expect(() => fromBackup(JSON.stringify({ app: 'out-the-door', data: { version: 99 } }))).toThrow(/newer version/);
    const broken = JSON.parse(toBackup(seedData()));
    broken.data.tasks[0].handsOnSec = 'three';
    expect(() => fromBackup(JSON.stringify(broken))).toThrow(/hands-on/);
  });

  it('forgets an in-progress run that no longer exists, and tasks a flow lists twice or that are gone', () => {
    const data = seedData();
    const flow = data.flows[0]!;
    flow.items = [flow.items[0]!, flow.items[0]!, { taskId: 'deleted', optional: false }];
    const tidy = validateData(JSON.parse(JSON.stringify({ ...data, activeRunId: 'gone' })));
    expect(tidy.activeRunId).toBeUndefined();
    expect(tidy.flows[0]!.items).toEqual([flow.items[0]]);
  });
});

describe('moving from version 1', () => {
  // What the app saved before flows: one routine holding its own tasks.
  const v1 = {
    version: 1,
    routines: [
      {
        id: 'r1',
        name: 'Morning',
        tasks: [
          { id: 't1', name: 'Brush teeth', handsOnSec: 180, waitSec: 0, after: [], optional: false },
          { id: 't2', name: 'Wash hair', handsOnSec: 600, waitSec: 0, after: [], optional: true },
          { id: 't3', name: 'Do hair', handsOnSec: 600, waitSec: 0, after: ['t2'], optional: false },
        ],
      },
    ],
    activeRoutineId: 'r1',
    plans: [{ date: '2026-10-20', routineId: 'r1', optionalOn: ['t2'], leaveBy: '07:45', bufferMin: 10 }],
    runs: [
      {
        id: 'run1',
        routineId: 'r1',
        date: '2026-10-19',
        tasks: [{ id: 't1', name: 'Brush teeth', handsOnSec: 180, waitSec: 0, after: [], optional: false }],
        optionalOn: [],
        leaveBy: 1_000,
        startedAt: 0,
        finishedAt: 500,
        events: [{ id: 'e1', at: 200, type: 'done', taskId: 't1' }],
      },
    ],
    settings: { bufferMin: 10 },
    lastLeaveBy: '07:30',
  };

  it('turns the routine into a flow using the same tasks, order and optional switches', () => {
    const data = validateData(v1);
    expect(data.version).toBe(2);
    expect(data.tasks).toEqual([
      { id: 't1', name: 'Brush teeth', handsOnSec: 180, waitSec: 0, after: [] },
      { id: 't2', name: 'Wash hair', handsOnSec: 600, waitSec: 0, after: [] },
      { id: 't3', name: 'Do hair', handsOnSec: 600, waitSec: 0, after: ['t2'] },
    ]);
    expect(data.flows).toEqual([
      {
        id: 'r1',
        name: 'Morning',
        ending: 'leave',
        items: [
          { taskId: 't1', optional: false },
          { taskId: 't2', optional: true },
          { taskId: 't3', optional: false },
        ],
        usual: { mode: 'doneBy', time: '07:30' },
      },
    ]);
    expect(data.activeFlowId).toBe('r1');
  });

  it('keeps plans and history, so usual times carry straight over', () => {
    const data = validateData(v1);
    expect(data.plans).toEqual([
      {
        date: '2026-10-20',
        flowId: 'r1',
        optionalOn: ['t2'],
        extras: [],
        changes: [],
        mode: 'doneBy',
        time: '07:45',
        bufferMin: 10,
      },
    ]);
    expect(data.runs[0]).toMatchObject({ flowId: 'r1', flowName: 'Morning', ending: 'leave', finishBy: 1_000 });
    expect(data.runs[0]!.events).toHaveLength(1);
  });

  it('migrates old backup files too', () => {
    const file = JSON.stringify({ app: 'out-the-door', exportedAt: '2026-10-18T00:00:00Z', data: v1 });
    expect(fromBackup(file).flows[0]!.name).toBe('Morning');
  });
});

describe('flows', () => {
  it('give the engine their own order and optional switches over shared tasks', () => {
    const data = seedData();
    const [teeth, coffee] = data.tasks;
    const weekend = {
      id: 'w',
      name: 'Weekend',
      ending: 'done' as const,
      items: [
        { taskId: coffee!.id, optional: true },
        { taskId: teeth!.id, optional: false },
      ],
    };
    expect(flowTasks(data.tasks, weekend).map((t) => [t.name, t.optional])).toEqual([
      ['Make coffee', true],
      ['Brush teeth', false],
    ]);
    expect(flowsUsing([data.flows[0]!, weekend], teeth!.id).map((f) => f.name)).toEqual(['Morning', 'Weekend']);
    expect(ruleGraph(data.tasks)).toHaveLength(data.tasks.length);
  });

  it("add a day's extra tasks after their own, once each, leaving out deleted ones", () => {
    const data = seedData();
    const [teeth, coffee] = data.tasks;
    const weekend = {
      id: 'w',
      name: 'Weekend',
      ending: 'done' as const,
      items: [{ taskId: teeth!.id, optional: false }],
    };
    const parcel = { id: 'p', name: 'Drop off parcel', handsOnSec: 600, waitSec: 0, after: [] };
    const extras = [
      { taskId: coffee!.id },
      { taskId: teeth!.id },
      { taskId: 'gone' },
      { oneOff: parcel },
      { taskId: coffee!.id },
    ];
    expect(dayTasks(data.tasks, weekend, { extras }).map((t) => [t.name, t.optional])).toEqual([
      ['Brush teeth', false],
      ['Make coffee', false],
      ['Drop off parcel', false],
    ]);
    expect(dayTasks(data.tasks, weekend).map((t) => t.name)).toEqual(['Brush teeth']);
  });

  it("apply a day's changes to its own tasks and its extras, and drop the ones left out", () => {
    const data = seedData();
    const [teeth, coffee, breakfast] = data.tasks;
    const weekend = {
      id: 'w',
      name: 'Weekend',
      ending: 'done' as const,
      items: [
        { taskId: teeth!.id, optional: false },
        { taskId: coffee!.id, optional: false },
      ],
    };
    const plan = {
      extras: [{ taskId: breakfast!.id }],
      changes: [
        { taskId: teeth!.id, handsOnSec: 60 },
        { taskId: coffee!.id, leftOut: true },
        { taskId: breakfast!.id, name: 'Feed the dog' },
        { taskId: 'gone', name: 'Not in the plan' },
      ],
    };
    const day = planTasks(data.tasks, weekend, plan);
    expect(day.map((d) => [d.task.name, d.task.handsOnSec, d.added, d.changed, d.leftOut])).toEqual([
      ['Brush teeth', 60, false, true, false],
      ['Make coffee', coffee!.handsOnSec, false, false, true],
      ['Feed the dog', breakfast!.handsOnSec, true, true, false],
    ]);
    expect(dayTasks(data.tasks, weekend, plan).map((t) => t.name)).toEqual(['Brush teeth', 'Feed the dog']);
    expect(teeth!.handsOnSec).not.toBe(60);
  });

  it("merge one task's change into a day's, dropping a change that's back to nothing", () => {
    const changes = [
      { taskId: 'a', handsOnSec: 60 },
      { taskId: 'b', leftOut: true },
    ];
    expect(withChange(changes, 'a', { name: 'Quick shower' })).toEqual([
      { taskId: 'b', leftOut: true },
      { taskId: 'a', name: 'Quick shower', handsOnSec: 60 },
    ]);
    expect(withChange(changes, 'a', { handsOnSec: undefined })).toEqual([{ taskId: 'b', leftOut: true }]);
    expect(withChange(changes, 'b', { leftOut: undefined })).toEqual([{ taskId: 'a', handsOnSec: 60 }]);
    expect(withChange([], 'c', { leftOut: true })).toEqual([{ taskId: 'c', leftOut: true }]);
  });

  it("keep a day's extras and changes in backups, and read older plans as having none", () => {
    const data = seedData();
    const flowId = data.flows[0]!.id;
    const oneOff = { id: 'p', name: 'Drop off parcel', handsOnSec: 600, waitSec: 0, after: [] };
    const plan = { date: '2026-10-20', flowId, optionalOn: [], mode: 'doneBy' as const, bufferMin: 10 };
    const extras = [{ taskId: data.tasks[0]!.id }, { oneOff }];
    const changes = [
      { taskId: data.tasks[1]!.id, name: 'Coffee', handsOnSec: 120 },
      { taskId: data.tasks[2]!.id, leftOut: true },
    ];
    const kept = fromBackup(toBackup({ ...data, plans: [{ ...plan, extras, changes }] })).plans[0]!;
    expect([kept.extras, kept.changes]).toEqual([extras, changes]);
    const older = validateData({ ...data, plans: [plan] }).plans[0]!;
    expect([older.extras, older.changes]).toEqual([[], []]);
  });
});
