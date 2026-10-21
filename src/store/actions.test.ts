import { beforeEach, describe, expect, it } from 'vitest';
import { MIN, T0, task } from '../engine/test-helpers';
import { addDays, atTime, dateKey } from '../engine/time';
import {
  activeRun,
  addToFlow,
  createFlow,
  deleteFlow,
  deleteRuns,
  deleteTaskEverywhere,
  discardRun,
  finishRun,
  moveInFlow,
  removeFromFlow,
  replaceAll,
  savePlan,
  saveTaskInFlow,
  selectFlow,
  startRun,
  tasksOf,
} from './actions';
import { offeredFinishBy } from './flows';
import { seedData } from './schema';
import { getData } from './store';

// Tests run in Node, where there's no localStorage, so the store just keeps the document in memory.
beforeEach(() => replaceAll(seedData()));

const morning = () => getData().flows[0]!;
const idOf = (name: string) => getData().tasks.find((t) => t.name === name)!.id;
const names = (flow = getData().flows.find((f) => f.id === getData().activeFlowId)!) =>
  tasksOf(getData(), flow).map((t) => t.name);
const tomorrow = () => addDays(dateKey(Date.now()), 1);

describe('flows', () => {
  it('makes a new flow empty or with the same tasks as another, and picks it', () => {
    const dinner = createFlow('Dinner', 'done');
    expect(getData().activeFlowId).toBe(dinner);
    expect(names()).toEqual([]);

    const wake = createFlow('Wake up', 'leave', morning().id);
    expect(names()).toEqual(names(morning()));
    // The copy has its own order.
    moveInFlow(wake, 0, 3);
    expect(names()[3]).toBe('Brush teeth');
    expect(names(morning())[0]).toBe('Brush teeth');
  });

  it('shares task details between flows, but each flow has its own optional switch', () => {
    const wake = createFlow('Wake up', 'leave');
    const teeth = idOf('Brush teeth');
    addToFlow(wake, teeth);
    const def = getData().tasks.find((t) => t.id === teeth)!;
    saveTaskInFlow(wake, { ...def, handsOnSec: 4 * 60 }, true);

    const inWake = tasksOf(getData()).find((t) => t.id === teeth)!;
    const inMorning = tasksOf(getData(), morning()).find((t) => t.id === teeth)!;
    expect([inWake.handsOnSec, inWake.optional]).toEqual([240, true]);
    expect([inMorning.handsOnSec, inMorning.optional]).toEqual([240, false]);

    // Taking it out of one flow leaves it in your task list.
    removeFromFlow(wake, teeth);
    expect(names()).toEqual([]);
    expect(names(morning())).toContain('Brush teeth');
  });

  it('adds a brand-new task to the list and the flow', () => {
    const wake = createFlow('Wake up', 'leave');
    saveTaskInFlow(wake, { id: 'stretch', name: 'Stretch', handsOnSec: 300, waitSec: 0, after: [] }, false);
    expect(names()).toEqual(['Stretch']);
    expect(names(morning())).not.toContain('Stretch');
  });

  it('deletes a task everywhere, along with the rules that waited for it', () => {
    const clothes = idOf('Get clothes');
    createFlow('Wake up', 'leave', morning().id);
    deleteTaskEverywhere(clothes);
    expect(getData().tasks.some((t) => t.id === clothes || t.after.includes(clothes))).toBe(false);
    expect(getData().flows.every((f) => f.items.every((i) => i.taskId !== clothes))).toBe(true);
  });

  it("won't delete the last flow or the one that's running, and deletes a flow's plans with it", () => {
    deleteFlow(morning().id);
    expect(getData().flows).toHaveLength(1);

    const dinner = createFlow('Dinner', 'done', morning().id);
    startRun([], undefined, T0);
    deleteFlow(dinner);
    expect(getData().flows).toHaveLength(2);

    finishRun(T0 + 30 * MIN);
    savePlan({
      date: tomorrow(),
      flowId: dinner,
      optionalOn: [],
      extras: [],
      changes: [],
      mode: 'doneBy',
      time: '18:00',
      bufferMin: 0,
    });
    deleteFlow(dinner);
    expect(getData().flows.map((f) => f.name)).toEqual(['Morning']);
    expect(getData().activeFlowId).toBe(morning().id);
    expect(getData().plans).toEqual([]);
    // Its history stays.
    expect(getData().runs.map((r) => r.flowName)).toEqual(['Dinner']);
  });
});

describe('starting a run', () => {
  it('runs the picked flow: its name, ending and tasks', () => {
    const dinner = createFlow('Dinner', 'done');
    addToFlow(dinner, idOf('Make coffee'));
    startRun([], '18:30', T0);
    const run = activeRun(getData())!;
    expect([run.flowId, run.flowName, run.ending]).toEqual([dinner, 'Dinner', 'done']);
    expect(run.tasks.map((t) => t.name)).toEqual(['Make coffee']);
    expect(run.finishBy).toBe(atTime(dateKey(T0), '18:30'));
  });

  it("includes tasks added to today's plan, after the flow's own", () => {
    const today = dateKey(T0);
    const pack = idOf('Pack bag');
    savePlan({
      date: today,
      flowId: morning().id,
      optionalOn: [],
      extras: [
        { taskId: pack },
        { oneOff: { id: 'parcel', name: 'Drop off parcel', handsOnSec: 600, waitSec: 0, after: [] } },
      ],
      changes: [],
      mode: 'doneBy',
      bufferMin: 10,
    });
    startRun([], undefined, T0);
    const names = activeRun(getData())!.tasks.map((t) => t.name);
    // Pack bag is already in Morning (switched off), so it isn't added a second time.
    expect(names.slice(-2)).toEqual(['Do hair', 'Drop off parcel']);
    expect(names.filter((n) => n === 'Pack bag')).toHaveLength(0);
  });

  it("runs today's changes: one task shorter, another left out, the tasks themselves untouched", () => {
    savePlan({
      date: dateKey(T0),
      flowId: morning().id,
      optionalOn: [],
      extras: [],
      changes: [
        { taskId: idOf('Brush teeth'), handsOnSec: 60 },
        { taskId: idOf('Make coffee'), leftOut: true },
      ],
      mode: 'doneBy',
      bufferMin: 10,
    });
    startRun([], undefined, T0);
    const tasks = activeRun(getData())!.tasks;
    expect(tasks.find((t) => t.name === 'Brush teeth')?.handsOnSec).toBe(60);
    expect(tasks.some((t) => t.name === 'Make coffee')).toBe(false);
    expect(getData().tasks.find((t) => t.name === 'Brush teeth')?.handsOnSec).not.toBe(60);
  });

  it('goes back to the flow that ran when it finishes, even after looking at another', () => {
    const dinner = createFlow('Dinner', 'done', morning().id);
    selectFlow(morning().id);
    startRun([], undefined, T0);
    selectFlow(dinner);
    finishRun(T0 + 40 * MIN);
    expect(getData().activeFlowId).toBe(morning().id);

    startRun([], undefined, T0 + 60 * MIN);
    selectFlow(dinner);
    discardRun();
    expect(getData().activeFlowId).toBe(morning().id);
  });

  it('remembers the finish-by time for next time, unless the flow is planned by its start time', () => {
    startRun([], '07:30', T0);
    expect(morning().usual).toEqual({ mode: 'doneBy', time: '07:30' });
    finishRun(T0 + 40 * MIN);

    startRun([], undefined, T0 + 60 * MIN);
    expect(morning().usual).toBeUndefined();
    finishRun(T0 + 100 * MIN);

    savePlan({
      date: tomorrow(),
      flowId: morning().id,
      optionalOn: [],
      extras: [],
      changes: [],
      mode: 'startAt',
      time: '06:15',
      bufferMin: 10,
    });
    expect(morning().usual).toEqual({ mode: 'startAt', time: '06:15' });
    startRun([], '07:10', T0 + 120 * MIN);
    expect(morning().usual).toEqual({ mode: 'startAt', time: '06:15' });
  });
});

describe('deleting runs', () => {
  it('takes finished runs out of History, but never the one in progress', () => {
    startRun([], undefined, T0);
    finishRun(T0 + 5 * MIN); // a test run, way off
    startRun([], undefined, T0 + 60 * MIN);
    finishRun(T0 + 100 * MIN);
    startRun([], undefined, T0 + 120 * MIN);
    const [test, real, running] = getData().runs.map((r) => r.id);
    deleteRuns([test!, running!]);
    expect(getData().runs.map((r) => r.id)).toEqual([real, running]);
    expect(activeRun(getData())?.id).toBe(running);
  });
});

describe('the finish-by time Start offers', () => {
  const tasks = [task('a', 10), task('b', 5), task('c', 20, { optional: true })];
  const day = '2026-10-19';

  it('is empty with no time, and a done-by time as it is', () => {
    expect(offeredFinishBy(tasks, new Set(), undefined, day)).toBe('');
    expect(offeredFinishBy(tasks, new Set(), { mode: 'doneBy' }, day)).toBe('');
    expect(offeredFinishBy(tasks, new Set(), { mode: 'doneBy', time: '07:30' }, day)).toBe('07:30');
  });

  it('works out the finish of a start-at time, with the optional tasks that are on', () => {
    expect(offeredFinishBy(tasks, new Set(), { mode: 'startAt', time: '06:50' }, day)).toBe('07:05');
    expect(offeredFinishBy(tasks, new Set(['c']), { mode: 'startAt', time: '06:50' }, day)).toBe('07:25');
  });
});
